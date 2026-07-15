#![cfg(windows)]

use std::{
    ffi::c_void,
    io, ptr,
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::GetLastError,
    Networking::WinHttp::{
        WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest,
        WinHttpQueryDataAvailable, WinHttpQueryHeaders, WinHttpReadData, WinHttpReceiveResponse,
        WinHttpSendRequest, WinHttpSetOption, WinHttpSetTimeouts,
        WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_FLAG_SECURE, WINHTTP_OPTION_REDIRECT_POLICY,
        WINHTTP_OPTION_REDIRECT_POLICY_NEVER, WINHTTP_QUERY_CONTENT_TYPE,
        WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_QUERY_RETRY_AFTER, WINHTTP_QUERY_STATUS_CODE,
    },
};

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

fn last_error(operation: &str) -> io::Error {
    let code = unsafe { GetLastError() };
    io::Error::other(format!("{operation} failed: Win32 {code}"))
}

struct ParsedUrl {
    secure: bool,
    host: String,
    port: u16,
    path: String,
}

fn parse_url(value: &str) -> io::Result<ParsedUrl> {
    let (secure, rest, default_port) = if let Some(rest) = value.strip_prefix("https://") {
        (true, rest, 443)
    } else if let Some(rest) = value.strip_prefix("http://") {
        (false, rest, 80)
    } else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "only http/https URLs are supported",
        ));
    };
    let split = rest.find('/').unwrap_or(rest.len());
    let authority = &rest[..split];
    let path = if split < rest.len() {
        &rest[split..]
    } else {
        "/"
    };
    if authority.is_empty() || authority.contains('@') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid URL authority",
        ));
    }
    let (host, port) = if authority.starts_with('[') {
        let end = authority
            .find(']')
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid IPv6 URL"))?;
        let host = authority[1..end].to_string();
        let port = authority
            .get(end + 1..)
            .and_then(|tail| tail.strip_prefix(':'))
            .map(str::parse::<u16>)
            .transpose()
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid URL port"))?
            .unwrap_or(default_port);
        (host, port)
    } else if let Some((host, port)) = authority.rsplit_once(':') {
        let port = port
            .parse::<u16>()
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid URL port"))?;
        (host.to_string(), port)
    } else {
        (authority.to_string(), default_port)
    };
    if host.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "URL host is empty",
        ));
    }
    Ok(ParsedUrl {
        secure,
        host,
        port,
        path: path.to_string(),
    })
}

struct Handles {
    session: *mut c_void,
    connection: *mut c_void,
    request: *mut c_void,
}

impl Drop for Handles {
    fn drop(&mut self) {
        unsafe {
            if !self.request.is_null() {
                WinHttpCloseHandle(self.request);
            }
            if !self.connection.is_null() {
                WinHttpCloseHandle(self.connection);
            }
            if !self.session.is_null() {
                WinHttpCloseHandle(self.session);
            }
        }
    }
}

#[derive(Clone, Debug)]
pub struct ResponseHead {
    pub status: u32,
    pub content_type: Option<String>,
    pub retry_after: Option<String>,
}

fn query_header(request: *mut c_void, query: u32) -> Option<String> {
    // Activity headers are deliberately bounded; an oversized/malformed value is ignored.
    let mut output = vec![0u16; 2048];
    let mut size = (output.len() * std::mem::size_of::<u16>()) as u32;
    let ok = unsafe {
        WinHttpQueryHeaders(
            request,
            query,
            ptr::null(),
            output.as_mut_ptr() as *mut c_void,
            &mut size,
            ptr::null_mut(),
        )
    };
    if ok == 0 || size == 0 {
        return None;
    }
    let length = (size as usize / std::mem::size_of::<u16>()).min(output.len());
    let value = String::from_utf16_lossy(&output[..length])
        .trim_matches('\0')
        .trim()
        .to_string();
    (!value.is_empty()).then_some(value)
}

fn open_request(
    method: &str,
    url: &str,
    headers: &[(&str, String)],
    body: &[u8],
    receive_timeout_ms: i32,
) -> io::Result<(Handles, ResponseHead)> {
    let parsed = parse_url(url)?;
    let agent = wide(&format!("NekoPresenceAgent/{}", env!("CARGO_PKG_VERSION")));
    let session = unsafe {
        WinHttpOpen(
            agent.as_ptr(),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            ptr::null(),
            ptr::null(),
            0,
        )
    };
    if session.is_null() {
        return Err(last_error("WinHttpOpen"));
    }
    let operation_timeout_ms = receive_timeout_ms.clamp(1, 10_000);
    unsafe {
        WinHttpSetTimeouts(
            session,
            operation_timeout_ms,
            operation_timeout_ms,
            operation_timeout_ms,
            receive_timeout_ms,
        );
    }
    let host = wide(&parsed.host);
    let connection = unsafe { WinHttpConnect(session, host.as_ptr(), parsed.port, 0) };
    if connection.is_null() {
        unsafe {
            WinHttpCloseHandle(session);
        }
        return Err(last_error("WinHttpConnect"));
    }
    let verb = wide(method);
    let path = wide(&parsed.path);
    let flags = if parsed.secure {
        WINHTTP_FLAG_SECURE
    } else {
        0
    };
    let request = unsafe {
        WinHttpOpenRequest(
            connection,
            verb.as_ptr(),
            path.as_ptr(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            flags,
        )
    };
    if request.is_null() {
        unsafe {
            WinHttpCloseHandle(connection);
            WinHttpCloseHandle(session);
        }
        return Err(last_error("WinHttpOpenRequest"));
    }
    let handles = Handles {
        session,
        connection,
        request,
    };
    let redirect_policy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
    if unsafe {
        WinHttpSetOption(
            handles.request,
            WINHTTP_OPTION_REDIRECT_POLICY,
            &redirect_policy as *const _ as *const c_void,
            std::mem::size_of_val(&redirect_policy) as u32,
        )
    } == 0
    {
        return Err(last_error("WinHttpSetOption(redirect policy)"));
    }
    let header_text = headers
        .iter()
        .map(|(name, value)| format!("{name}: {value}\r\n"))
        .collect::<String>();
    let header_wide = wide(&header_text);
    let optional = if body.is_empty() {
        ptr::null()
    } else {
        body.as_ptr() as *const c_void
    };
    let sent = unsafe {
        WinHttpSendRequest(
            handles.request,
            if header_text.is_empty() {
                ptr::null()
            } else {
                header_wide.as_ptr()
            },
            header_text.encode_utf16().count() as u32,
            optional,
            body.len() as u32,
            body.len() as u32,
            0,
        )
    };
    if sent == 0 {
        return Err(last_error("WinHttpSendRequest"));
    }
    if unsafe { WinHttpReceiveResponse(handles.request, ptr::null_mut()) } == 0 {
        return Err(last_error("WinHttpReceiveResponse"));
    }
    let mut status = 0u32;
    let mut status_size = std::mem::size_of::<u32>() as u32;
    let queried = unsafe {
        WinHttpQueryHeaders(
            handles.request,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            ptr::null(),
            &mut status as *mut _ as *mut c_void,
            &mut status_size,
            ptr::null_mut(),
        )
    };
    if queried == 0 {
        return Err(last_error("WinHttpQueryHeaders"));
    }
    let head = ResponseHead {
        status,
        content_type: query_header(handles.request, WINHTTP_QUERY_CONTENT_TYPE),
        retry_after: query_header(handles.request, WINHTTP_QUERY_RETRY_AFTER),
    };
    Ok((handles, head))
}

fn read_chunk(request: *mut c_void) -> io::Result<Option<Vec<u8>>> {
    let mut available = 0u32;
    if unsafe { WinHttpQueryDataAvailable(request, &mut available) } == 0 {
        return Err(last_error("WinHttpQueryDataAvailable"));
    }
    if available == 0 {
        return Ok(None);
    }
    let mut output = vec![0u8; available.min(64 * 1024) as usize];
    let mut read = 0u32;
    if unsafe {
        WinHttpReadData(
            request,
            output.as_mut_ptr() as *mut c_void,
            output.len() as u32,
            &mut read,
        )
    } == 0
    {
        return Err(last_error("WinHttpReadData"));
    }
    output.truncate(read as usize);
    Ok((read > 0).then_some(output))
}

#[derive(Default)]
struct SseLineDecoder {
    pending: Vec<u8>,
    at_start: bool,
}

impl SseLineDecoder {
    fn new() -> Self {
        Self {
            pending: Vec::new(),
            at_start: true,
        }
    }

    fn strip_bom_if_ready(&mut self, eof: bool) -> bool {
        if !self.at_start {
            return true;
        }
        const BOM: &[u8] = b"\xef\xbb\xbf";
        if self.pending.len() < BOM.len() && !eof && BOM.starts_with(self.pending.as_slice()) {
            return false;
        }
        if self.pending.starts_with(BOM) {
            self.pending.drain(..BOM.len());
        }
        self.at_start = false;
        true
    }

    fn push<F>(&mut self, chunk: &[u8], on_line: &mut F) -> io::Result<()>
    where
        F: FnMut(&str),
    {
        self.pending.extend_from_slice(chunk);
        if !self.strip_bom_if_ready(false) {
            return Ok(());
        }
        while let Some(index) = self
            .pending
            .iter()
            .position(|byte| matches!(*byte, b'\r' | b'\n'))
        {
            let separator = self.pending[index];
            if separator == b'\r' && index + 1 == self.pending.len() {
                // A CR at a chunk boundary may be the first half of CRLF.
                break;
            }
            let consumed = if separator == b'\r' && self.pending.get(index + 1) == Some(&b'\n') {
                index + 2
            } else {
                index + 1
            };
            let line = self.pending[..index].to_vec();
            self.pending.drain(..consumed);
            on_line(&String::from_utf8_lossy(&line));
        }
        if self.pending.len() > 64 * 1024 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "SSE line exceeds 64KiB",
            ));
        }
        Ok(())
    }

    fn finish<F>(&mut self, on_line: &mut F)
    where
        F: FnMut(&str),
    {
        if !self.strip_bom_if_ready(true) {
            return;
        }
        // A terminal CR is a complete line ending. Any other unterminated bytes are
        // deliberately discarded; the SSE parser must not dispatch a partial event at EOF.
        if self.pending.last() == Some(&b'\r') {
            let line = self.pending[..self.pending.len() - 1].to_vec();
            on_line(&String::from_utf8_lossy(&line));
        }
        self.pending.clear();
    }
}

pub struct Response {
    pub status: u32,
    pub content_type: Option<String>,
    pub retry_after: Option<String>,
    pub body: Vec<u8>,
}

pub struct StreamResponse {
    pub head: ResponseHead,
    pub error_body: Vec<u8>,
}

pub fn request(
    method: &str,
    url: &str,
    headers: &[(&str, String)],
    body: &[u8],
    timeout_ms: i32,
) -> io::Result<Response> {
    let (handles, head) = open_request(method, url, headers, body, timeout_ms)?;
    let mut output = Vec::new();
    while let Some(chunk) = read_chunk(handles.request)? {
        if output.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "HTTP response exceeds 2MiB",
            ));
        }
        output.extend_from_slice(&chunk);
    }
    Ok(Response {
        status: head.status,
        content_type: head.content_type,
        retry_after: head.retry_after,
        body: output,
    })
}

pub fn stream_lines<F, O, C>(
    url: &str,
    headers: &[(&str, String)],
    mut on_line: F,
    mut on_open: O,
    should_continue: C,
) -> io::Result<StreamResponse>
where
    F: FnMut(&str),
    O: FnMut(&ResponseHead),
    C: Fn() -> bool + Sync,
{
    let (mut handles, head) = open_request("GET", url, headers, &[], 45_000)?;
    if head.status != 200 || !is_content_type(&head.content_type, "text/event-stream") {
        let mut error_body = Vec::new();
        while let Some(chunk) = read_chunk(handles.request)? {
            if error_body.len() + chunk.len() > 64 * 1024 {
                break;
            }
            error_body.extend_from_slice(&chunk);
        }
        return Ok(StreamResponse { head, error_body });
    }
    // This is the point at which EventSource is open: response headers were accepted,
    // not the later point at which the long-lived response happens to end.
    on_open(&head);
    let mut decoder = SseLineDecoder::new();
    let stop_monitor = AtomicBool::new(false);
    let request_closed = AtomicBool::new(false);
    let request_handle = handles.request as usize;
    let read_result = thread::scope(|scope| {
        let monitor = scope.spawn(|| {
            while !stop_monitor.load(Ordering::Acquire) {
                if !should_continue() {
                    request_closed.store(true, Ordering::Release);
                    unsafe {
                        WinHttpCloseHandle(request_handle as *mut c_void);
                    }
                    break;
                }
                thread::sleep(Duration::from_millis(25));
            }
        });
        let result = (|| -> io::Result<()> {
            while should_continue() {
                let Some(chunk) = read_chunk(handles.request)? else {
                    break;
                };
                let mut dispatch = |line: &str| {
                    if should_continue() {
                        on_line(line);
                    }
                };
                decoder.push(&chunk, &mut dispatch)?;
            }
            let mut dispatch = |line: &str| {
                if should_continue() {
                    on_line(line);
                }
            };
            decoder.finish(&mut dispatch);
            Ok(())
        })();
        stop_monitor.store(true, Ordering::Release);
        let _ = monitor.join();
        result
    });
    if request_closed.load(Ordering::Acquire) {
        // The cancellation monitor owns this close. Prevent Handles::drop from closing the
        // same WinHTTP request a second time.
        handles.request = ptr::null_mut();
    }
    read_result?;
    Ok(StreamResponse {
        head,
        error_body: Vec::new(),
    })
}

pub fn is_content_type(value: &Option<String>, expected: &str) -> bool {
    value
        .as_deref()
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .is_some_and(|value| value.eq_ignore_ascii_case(expected))
}

#[cfg(test)]
mod tests {
    use super::{is_content_type, parse_url, request, stream_lines, SseLineDecoder};
    use std::{
        cell::RefCell,
        io::{Read, Write},
        net::TcpListener,
        rc::Rc,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        thread,
        time::{Duration, Instant},
    };

    fn mock_response(response: &'static [u8]) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 4096];
            let _ = stream.read(&mut request);
            stream.write_all(response).unwrap();
            stream.flush().unwrap();
        });
        (format!("http://{address}/activity"), handle)
    }

    #[test]
    fn parses_https_and_custom_ports() {
        let parsed = parse_url("https://example.com:8443/api/events?after=1").unwrap();
        assert!(parsed.secure);
        assert_eq!(parsed.host, "example.com");
        assert_eq!(parsed.port, 8443);
        assert_eq!(parsed.path, "/api/events?after=1");
    }

    #[test]
    fn content_type_comparison_ignores_parameters_and_case() {
        assert!(is_content_type(
            &Some("Text/Event-Stream; charset=utf-8".into()),
            "text/event-stream"
        ));
        assert!(!is_content_type(
            &Some("text/html; charset=utf-8".into()),
            "text/event-stream"
        ));
        assert!(!is_content_type(&None, "application/json"));
    }

    #[test]
    fn request_does_not_follow_redirects_and_reports_html_content_type() {
        let (redirect_url, redirect_server) = mock_response(
            b"HTTP/1.1 307 Temporary Redirect\r\nLocation: http://example.invalid/login\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
        let redirected = request("GET", &redirect_url, &[], &[], 2_000).unwrap();
        assert_eq!(redirected.status, 307);
        redirect_server.join().unwrap();

        let (html_url, html_server) = mock_response(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: 13\r\nConnection: close\r\n\r\n<html></html>",
        );
        let html = request("GET", &html_url, &[], &[], 2_000).unwrap();
        assert_eq!(html.status, 200);
        assert_eq!(
            html.content_type.as_deref(),
            Some("text/html; charset=utf-8")
        );
        html_server.join().unwrap();
    }

    #[test]
    fn sse_open_callback_runs_before_stream_lines_and_eof_returns() {
        let (url, server) = mock_response(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nConnection: close\r\n\r\n: heartbeat\nid: 42\ndata: {\"ok\":true}\n\n",
        );
        let calls = Rc::new(RefCell::new(Vec::<String>::new()));
        let line_calls = calls.clone();
        let open_calls = calls.clone();
        let head = stream_lines(
            &url,
            &[("Accept", "text/event-stream".into())],
            move |line| line_calls.borrow_mut().push(format!("line:{line}")),
            move |_| open_calls.borrow_mut().push("open".into()),
            || true,
        )
        .unwrap();
        assert_eq!(head.head.status, 200);
        let calls = calls.borrow();
        assert_eq!(calls.first().map(String::as_str), Some("open"));
        assert!(calls.iter().any(|call| call == "line:: heartbeat"));
        assert!(calls.iter().any(|call| call == "line:data: {\"ok\":true}"));
        server.join().unwrap();
    }

    #[test]
    fn blocked_sse_read_is_cancelled_without_waiting_for_receive_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 4096];
            let _ = stream.read(&mut request);
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
                )
                .unwrap();
            stream.flush().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            // No SSE bytes are sent. This read returns when the client-side cancellation
            // monitor closes the WinHTTP request handle.
            let _ = stream.read(&mut [0u8; 1]);
        });
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancel_signal = cancelled.clone();
        let canceller = thread::spawn(move || {
            thread::sleep(Duration::from_millis(100));
            cancel_signal.store(true, Ordering::Release);
        });
        let started = Instant::now();
        let result = stream_lines(
            &format!("http://{address}/activity"),
            &[("Accept", "text/event-stream".into())],
            |_| {},
            |_| {},
            || !cancelled.load(Ordering::Acquire),
        );
        let elapsed = started.elapsed();
        canceller.join().unwrap();
        server.join().unwrap();
        assert!(result.is_err());
        assert!(elapsed < Duration::from_secs(1), "cancel took {elapsed:?}");
    }

    #[test]
    fn sse_line_decoder_handles_bom_all_line_endings_and_chunk_boundaries() {
        let mut decoder = SseLineDecoder::new();
        let mut lines = Vec::<String>::new();
        decoder
            .push(b"\xef", &mut |line| lines.push(line.into()))
            .unwrap();
        decoder
            .push(b"\xbb\xbfid: 1\r", &mut |line| lines.push(line.into()))
            .unwrap();
        decoder
            .push(b"\ndata: first\rdata: second\n\r", &mut |line| {
                lines.push(line.into())
            })
            .unwrap();
        decoder.finish(&mut |line| lines.push(line.into()));
        assert_eq!(lines, ["id: 1", "data: first", "data: second", ""]);
    }

    #[test]
    fn sse_line_decoder_discards_unterminated_eof_data() {
        let mut decoder = SseLineDecoder::new();
        let mut lines = Vec::<String>::new();
        decoder
            .push(b"data: incomplete", &mut |line| lines.push(line.into()))
            .unwrap();
        decoder.finish(&mut |line| lines.push(line.into()));
        assert!(lines.is_empty());
    }
}
