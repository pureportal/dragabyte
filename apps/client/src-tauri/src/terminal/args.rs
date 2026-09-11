use crate::scan::{build_scan_config, ScanConfig, ScanOptions};
use clap::{Args, Parser, Subcommand};
use std::{net::SocketAddr, path::PathBuf};

#[derive(Parser)]
#[command(
    name = "dragabyte-cli",
    version,
    about = "Explore folder disk usage",
    args_conflicts_with_subcommands = true
)]
pub(super) struct Cli {
    #[command(subcommand)]
    pub command: Option<Action>,
    #[command(flatten)]
    pub explore: ExploreArgs,
}

#[derive(Subcommand)]
pub(super) enum Action {
    #[command(about = "Print folder usage")]
    Scan {
        #[command(flatten)]
        options: ExploreArgs,
        #[arg(long, help = "Write the complete scan as JSON")]
        json: bool,
        #[arg(
            long,
            default_value_t = 30,
            help = "Number of entries in the text report"
        )]
        top: usize,
    },
    #[command(about = "Run the management server without a desktop")]
    Serve {
        #[arg(long, env = "DRAGABYTE_TCP_BIND", default_value = "127.0.0.1:4799")]
        bind: SocketAddr,
        #[arg(long, env = "DRAGABYTE_TCP_TOKEN", hide_env_values = true)]
        token: Option<String>,
    },
}

#[derive(Args, Clone)]
pub(super) struct ExploreArgs {
    #[arg(default_value = ".")]
    pub path: PathBuf,
    #[arg(
        long,
        value_name = "REGEX",
        help = "Exclude matching paths (case-insensitive regex), including folder contents"
    )]
    pub exclude: Vec<String>,
    #[arg(long, value_parser = clap::value_parser!(u8).range(1..=64), help = "Scanner workers; use 1 for a rotating disk")]
    pub threads: Option<u8>,
    #[arg(long, help = "Use plain ASCII bars and borders")]
    pub ascii: bool,
    #[arg(long, help = "Disable terminal colors")]
    pub no_color: bool,
}

impl ExploreArgs {
    pub fn config(&self) -> Result<ScanConfig, String> {
        let mut options = ScanOptions::default();
        if !self.exclude.is_empty() {
            options.filters.exclude_regex = Some(
                self.exclude
                    .iter()
                    .map(|pattern| format!("(?i:{pattern})"))
                    .collect::<Vec<_>>()
                    .join("|"),
            );
        }
        let config = build_scan_config(&options)?;
        match self.threads {
            Some(count) => config.with_workers(count as usize),
            None => Ok(config),
        }
    }

    pub fn root(&self) -> Result<PathBuf, String> {
        self.path.canonicalize().map_err(|error| {
            format!(
                "Cannot open {}: {error}",
                super::format::safe_text(&self.path.to_string_lossy())
            )
        })
    }
}
