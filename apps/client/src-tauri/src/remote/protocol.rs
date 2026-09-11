use crate::scan::ScanOptions;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub(super) enum RemoteRequest {
    Ping {
        id: Option<String>,
    },
    List {
        id: Option<String>,
        path: Option<String>,
    },
    Disk {
        id: Option<String>,
        path: String,
    },
    Read {
        id: Option<String>,
        path: String,
    },
    Scan {
        id: Option<String>,
        path: String,
        options: Option<Box<ScanOptions>>,
    },
    Cancel {
        id: Option<String>,
    },
    Shutdown {
        id: Option<String>,
    },
}

#[derive(Deserialize)]
pub(super) struct RemoteEnvelope {
    pub(super) token: Option<String>,
    #[serde(flatten)]
    pub(super) request: RemoteRequest,
}

pub(super) fn request_id(request: &RemoteRequest) -> Option<&str> {
    match request {
        RemoteRequest::Ping { id }
        | RemoteRequest::List { id, .. }
        | RemoteRequest::Disk { id, .. }
        | RemoteRequest::Read { id, .. }
        | RemoteRequest::Scan { id, .. }
        | RemoteRequest::Cancel { id }
        | RemoteRequest::Shutdown { id } => id.as_deref(),
    }
}
