//! Bounded, content-free transport counters. Session IDs never leave this module's snapshot.
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub native_received: u64,
    pub native_written: u64,
    pub native_output: u64,
    pub native_read: u64,
    pub native_errors: u64,
    pub native_pause_seq: u64,
    pub native_paused: bool,
    pub native_resize_seq: u64,
    pub native_cols: u32,
    pub native_rows: u32,
}
pub enum Stage {
    Received,
    Written,
    Output,
    Read,
    Error,
}
struct Entry {
    at: Instant,
    counts: Counts,
}
#[derive(Default)]
pub struct Counters(Mutex<HashMap<String, Entry>>);
impl Counters {
    fn update(&self, id: &str, update: impl FnOnce(&mut Counts)) {
        if id.len() > 128 {
            return;
        }
        let mut entries = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        entries.retain(|_, e| now.duration_since(e.at) < Duration::from_secs(900));
        if !entries.contains_key(id) && entries.len() >= 128 {
            if let Some(oldest) = entries
                .iter()
                .min_by_key(|(_, e)| e.at)
                .map(|(k, _)| k.clone())
            {
                entries.remove(&oldest);
            }
        }
        let entry = entries.entry(id.to_owned()).or_insert_with(|| Entry {
            at: now,
            counts: Counts::default(),
        });
        entry.at = now;
        update(&mut entry.counts);
    }
    pub fn note(&self, id: &str, stage: Stage, bytes: usize) {
        self.update(id, |counts| {
            let field = match stage {
                Stage::Received => &mut counts.native_received,
                Stage::Written => &mut counts.native_written,
                Stage::Output => &mut counts.native_output,
                Stage::Read => &mut counts.native_read,
                Stage::Error => &mut counts.native_errors,
            };
            *field = field.saturating_add(bytes as u64);
        });
    }
    pub fn paused(&self, id: &str, paused: bool, sequence: u64) {
        self.update(id, |c| {
            c.native_paused = paused;
            c.native_pause_seq = sequence;
        });
    }
    pub fn resized(&self, id: &str, cols: u32, rows: u32) {
        self.update(id, |c| {
            c.native_cols = cols;
            c.native_rows = rows;
            c.native_resize_seq = c.native_resize_seq.saturating_add(1);
        });
    }
    pub fn snapshot(&self, ids: &[String]) -> Vec<Counts> {
        let mut entries = self.0.lock().unwrap_or_else(|e| e.into_inner());
        entries.retain(|_, e| e.at.elapsed() < Duration::from_secs(900));
        ids.iter()
            .take(128)
            .map(|id| {
                entries
                    .get(id)
                    .map(|e| e.counts.clone())
                    .unwrap_or_default()
            })
            .collect()
    }
}
pub fn counters() -> &'static Counters {
    static COUNTERS: OnceLock<Counters> = OnceLock::new();
    COUNTERS.get_or_init(Counters::default)
}
pub fn note(id: &str, stage: Stage, bytes: usize) {
    counters().note(id, stage, bytes);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshots_contain_counts_without_identifiers_or_payloads() {
        let c = Counters::default();
        c.note("secret-host-token", Stage::Received, 7);
        c.note("secret-host-token", Stage::Written, 7);
        c.note("secret-host-token", Stage::Output, 21);
        let s = serde_json::to_string(&c.snapshot(&["secret-host-token".into()])).unwrap();
        assert!(!s.contains("secret"));
        assert!(s.contains("21"));
    }
    #[test]
    fn session_memory_is_bounded_and_expired_entries_vanish() {
        let c = Counters::default();
        for i in 0..1000 {
            c.note(&i.to_string(), Stage::Output, 1);
        }
        assert_eq!(c.0.lock().unwrap().len(), 128);
        c.0.lock()
            .unwrap()
            .values_mut()
            .for_each(|e| e.at = Instant::now() - Duration::from_secs(901));
        c.snapshot(&[]);
        assert!(c.0.lock().unwrap().is_empty());
    }
    #[test]
    fn captures_applied_pause_sequence_and_pty_dimensions() {
        let c = Counters::default();
        c.paused("s", true, 4);
        c.paused("s", false, 5);
        c.resized("s", 120, 40);
        let counts = c.snapshot(&["s".into()]).remove(0);
        assert!(!counts.native_paused);
        assert_eq!(counts.native_pause_seq, 5);
        assert_eq!((counts.native_cols, counts.native_rows), (120, 40));
    }
}
