use std::collections::VecDeque;

pub const SAMPLE_INTERVAL_MS: u64 = 500;
const WINDOW_MS: u64 = 10_000;
const IDLE_AFTER_MS: u64 = 10_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sample {
    pub at_ms: u64,
    pub process_name: Option<String>,
    pub input_pulse: bool,
    pub mouse_active_inside: bool,
    pub force_idle: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DetectorKind {
    Interactive,
    Dominant,
    Passive,
}

impl DetectorKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Interactive => "interactive",
            Self::Dominant => "dominant",
            Self::Passive => "passive",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Transition {
    Active {
        process_name: String,
        stable_since_ms: u64,
        kind: DetectorKind,
    },
    Idle {
        at_ms: u64,
    },
}

#[derive(Default)]
pub struct ActivityDetector {
    samples: VecDeque<Sample>,
    stable_process: Option<String>,
    last_valid_at_ms: Option<u64>,
    idle_emitted: bool,
}

impl ActivityDetector {
    pub fn push(&mut self, mut sample: Sample) -> Option<Transition> {
        if sample.force_idle {
            self.samples.clear();
            self.last_valid_at_ms = None;
            return self.force_idle(sample.at_ms);
        }
        sample.process_name = sample
            .process_name
            .map(|p| p.trim().to_lowercase())
            .filter(|p| !p.is_empty());
        if sample.process_name.is_some() {
            self.last_valid_at_ms = Some(sample.at_ms);
            self.idle_emitted = false;
        }
        self.samples.push_back(sample.clone());
        while self
            .samples
            .front()
            .is_some_and(|first| sample.at_ms.saturating_sub(first.at_ms) > WINDOW_MS)
        {
            self.samples.pop_front();
        }

        let Some(current) = sample.process_name.as_ref() else {
            if !self.idle_emitted
                && self
                    .last_valid_at_ms
                    .is_some_and(|last| sample.at_ms.saturating_sub(last) >= IDLE_AFTER_MS)
            {
                self.stable_process = None;
                self.idle_emitted = true;
                return Some(Transition::Idle {
                    at_ms: sample.at_ms,
                });
            }
            return None;
        };
        if self.stable_process.as_ref() == Some(current) {
            return None;
        }

        let mut continuous_samples = 0usize;
        for candidate in self.samples.iter().rev() {
            if candidate.process_name.as_ref() == Some(current) {
                continuous_samples += 1;
            } else {
                break;
            }
        }
        let continuous_ms = continuous_samples.saturating_sub(1) as u64 * SAMPLE_INTERVAL_MS;
        let total = self.samples.len().max(1);
        let matching = self
            .samples
            .iter()
            .filter(|s| s.process_name.as_ref() == Some(current))
            .count();
        let share = matching as f64 / total as f64;
        let input_pulses = self
            .samples
            .iter()
            .filter(|s| s.process_name.as_ref() == Some(current) && s.input_pulse)
            .count();
        let mouse_pulses = self
            .samples
            .iter()
            .filter(|s| s.process_name.as_ref() == Some(current) && s.mouse_active_inside)
            .count();

        let kind = if continuous_ms >= 3_000 && (input_pulses >= 3 || mouse_pulses >= 2) {
            Some(DetectorKind::Interactive)
        } else if continuous_ms >= 2_000 && share >= 0.70 && input_pulses + mouse_pulses >= 3 {
            Some(DetectorKind::Dominant)
        } else if continuous_ms >= 7_000 {
            Some(DetectorKind::Passive)
        } else {
            None
        };

        kind.map(|kind| {
            self.stable_process = Some(current.clone());
            let stable_since_ms = sample.at_ms.saturating_sub(continuous_ms);
            Transition::Active {
                process_name: current.clone(),
                stable_since_ms,
                kind,
            }
        })
    }

    pub fn force_idle(&mut self, at_ms: u64) -> Option<Transition> {
        if self.stable_process.take().is_some() || !self.idle_emitted {
            self.idle_emitted = true;
            return Some(Transition::Idle { at_ms });
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(at_ms: u64, app: &str, input: bool) -> Sample {
        Sample {
            at_ms,
            process_name: Some(app.into()),
            input_pulse: input,
            mouse_active_inside: false,
            force_idle: false,
        }
    }

    #[test]
    fn interactive_path_confirms_quickly() {
        let mut detector = ActivityDetector::default();
        let mut transition = None;
        for i in 0..=6 {
            transition = transition.or_else(|| detector.push(sample(i * 500, "Code.exe", i >= 2)));
        }
        assert!(matches!(
            transition,
            Some(Transition::Active {
                kind: DetectorKind::Interactive | DetectorKind::Dominant,
                ..
            })
        ));
    }

    #[test]
    fn passive_path_requires_seven_seconds() {
        let mut detector = ActivityDetector::default();
        let mut found = None;
        for i in 0..=14 {
            found = detector.push(sample(i * 500, "vlc.exe", false));
        }
        assert!(matches!(
            found,
            Some(Transition::Active {
                kind: DetectorKind::Passive,
                ..
            })
        ));
    }

    #[test]
    fn rapid_switches_do_not_emit() {
        let mut detector = ActivityDetector::default();
        for i in 0..12 {
            let app = if i % 2 == 0 { "a.exe" } else { "b.exe" };
            assert_eq!(detector.push(sample(i * 500, app, true)), None);
        }
    }

    #[test]
    fn title_changes_are_irrelevant_because_key_is_process() {
        let mut detector = ActivityDetector::default();
        let mut count = 0;
        for i in 0..20 {
            if detector.push(sample(i * 500, "Code.exe", i > 1)).is_some() {
                count += 1;
            }
        }
        assert_eq!(count, 1);
    }

    #[test]
    fn dominant_path_accepts_seventy_percent_window_share() {
        let mut detector = ActivityDetector::default();
        assert_eq!(detector.push(sample(0, "other.exe", false)), None);
        assert_eq!(detector.push(sample(500, "other.exe", false)), None);
        let mut result = None;
        for i in 2..=6 {
            result = detector.push(sample(i * 500, "reader.exe", i >= 4));
        }
        assert!(matches!(
            result,
            Some(Transition::Active {
                kind: DetectorKind::Dominant,
                ..
            })
        ));
    }

    #[test]
    fn unstable_candidate_keeps_previous_public_state() {
        let mut detector = ActivityDetector::default();
        for i in 0..=6 {
            detector.push(sample(i * 500, "stable.exe", i >= 2));
        }
        assert_eq!(detector.stable_process.as_deref(), Some("stable.exe"));
        for i in 7..=10 {
            assert_eq!(detector.push(sample(i * 500, "brief.exe", false)), None);
        }
        assert_eq!(detector.stable_process.as_deref(), Some("stable.exe"));
    }

    #[test]
    fn ten_seconds_without_candidate_enters_idle() {
        let mut detector = ActivityDetector::default();
        for i in 0..=6 {
            detector.push(sample(i * 500, "stable.exe", i >= 2));
        }
        let idle = detector.push(Sample {
            at_ms: 13_000,
            process_name: None,
            input_pulse: false,
            mouse_active_inside: false,
            force_idle: false,
        });
        assert!(matches!(idle, Some(Transition::Idle { at_ms: 13_000 })));
    }

    #[test]
    fn lock_or_resume_gap_forces_idle_immediately() {
        let mut detector = ActivityDetector::default();
        for i in 0..=6 {
            detector.push(sample(i * 500, "stable.exe", i >= 2));
        }
        let idle = detector.push(Sample {
            at_ms: 3_500,
            process_name: None,
            input_pulse: false,
            mouse_active_inside: false,
            force_idle: true,
        });
        assert!(matches!(idle, Some(Transition::Idle { at_ms: 3_500 })));
    }
}
