#![cfg(windows)]

use std::{ffi::c_void, io, ptr};
use windows_sys::Win32::{
    Foundation::GetLastError,
    Networking::WinHttp::{
        WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest,
        WinHttpQueryDataAvailable, WinHttpQueryHeaders, WinHttpReadData, WinHttpReceiveResponse,
        WinHttpSendRequest, WinHttpSetTimeouts, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
        WINHTTP_FLAG_SECURE, WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_QUERY_STATUS_CODE,
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

fn open_request(
    method: &str,
    url: &str,
    headers: &[(&str, String)],
    body: &[u8],
    receive_timeout_ms: i32,
) -> io::Result<(Handles, u32)> {
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
    Ok((handles, status))
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

pub struct Response {
    pub status: u32,
    pub body: Vec<u8>,
}

pub fn request(
    method: &str,
    url: &str,
    headers: &[(&str, String)],
    body: &[u8],
    timeout_ms: i32,
) -> io::Result<Response> {
    let (handles, status) = open_request(method, url, headers, body, timeout_ms)?;
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
        status,
        body: output,
    })
}

pub fn stream_lines<F, C>(
    url: &str,
    headers: &[(&str, String)],
    mut on_line: F,
    should_continue: C,
) -> io::Result<u32>
where
    F: FnMut(&str),
    C: Fn() -> bool,
{
    let (handles, status) = open_request("GET", url, headers, &[], 45_000)?;
    if status >= 300 {
        return Ok(status);
    }
    let mut pending = Vec::<u8>::new();
    while should_continue() {
        let Some(chunk) = read_chunk(handles.request)? else {
            break;
        };
        pending.extend_from_slice(&chunk);
        while let Some(index) = pending.iter().position(|byte| *byte == b'\n') {
            let mut line = pending.drain(..=index).collect::<Vec<_>>();
            while matches!(line.last(), Some(b'\n' | b'\r')) {
                line.pop();
            }
            on_line(&String::from_utf8_lossy(&line));
        }
        if pending.len() > 64 * 1024 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "SSE line exceeds 64KiB",
            ));
        }
    }
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::parse_url;

    #[test]
    fn parses_https_and_custom_ports() {
        let parsed = parse_url("https://example.com:8443/api/events?after=1").unwrap();
        assert!(parsed.secure);
        assert_eq!(parsed.host, "example.com");
        assert_eq!(parsed.port, 8443);
        assert_eq!(parsed.path, "/api/events?after=1");
    }
}
