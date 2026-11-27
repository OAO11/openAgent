use portable_pty::{Child, MasterPty};
use std::sync::{mpsc, Mutex};

use super::*;

#[derive(Debug, Clone, Copy)]
pub(crate) struct TerminalSize {
    pub(crate) cols: u16,
    pub(crate) rows: u16,
}

pub(crate) struct TerminalSessionEntry {
    pub(crate) backend: TerminalSessionBackend,
    pub(crate) record: Mutex<TerminalSessionRecord>,
    pub(crate) output: Mutex<TerminalOutputBuffer>,
}

pub(crate) enum TerminalSessionBackend {
    Local {
        master: Mutex<Box<dyn MasterPty + Send>>,
        input_tx: mpsc::SyncSender<Vec<u8>>,
        child: Mutex<Box<dyn Child + Send + Sync>>,
    },
}

#[derive(Debug, Default)]
pub(crate) struct TerminalOutputDispatch {
    pub(crate) local: Vec<TerminalStreamEventPayload>,
    pub(crate) remote: Vec<TerminalStreamEventPayload>,
}
