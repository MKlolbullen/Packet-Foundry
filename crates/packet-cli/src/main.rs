//! `packet-foundry` — the command-line assembler.
//!
//! `create` builds a packet from an ordered protocol stack and writes it as JSON. `inspect` loads
//! a packet JSON and prints its structure plus freshly-computed diagnostics (it reports problems,
//! it does not fix them).

use std::net::Ipv4Addr;
use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use packet_core::{Diagnostic, Field, FieldKind, PacketDocument, Severity};
use protocol_engine::protocols::tcp;
use protocol_engine::{ProtocolSpec, assemble, validate};

#[derive(Parser)]
#[command(name = "packet-foundry", version, about = "A bidirectional assembler for wire formats")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Assemble a packet from a protocol stack and write it as JSON.
    Create(CreateArgs),
    /// Load a packet JSON and print its structure and diagnostics.
    Inspect(InspectArgs),
}

#[derive(Parser)]
struct CreateArgs {
    /// Protocol stack, in order — e.g. `ethernet ipv4 tcp`.
    #[arg(required = true, value_name = "PROTOCOL")]
    protocols: Vec<String>,

    #[arg(long)]
    src_mac: Option<String>,
    #[arg(long)]
    dst_mac: Option<String>,
    #[arg(long)]
    src_ip: Option<Ipv4Addr>,
    #[arg(long)]
    dst_ip: Option<Ipv4Addr>,
    #[arg(long)]
    src_port: Option<u16>,
    #[arg(long)]
    dst_port: Option<u16>,
    #[arg(long)]
    seq: Option<u32>,
    /// TCP flags, comma-separated — e.g. `syn` or `syn,ack`.
    #[arg(long)]
    flags: Option<String>,
    /// UTF-8 payload text appended as a raw layer.
    #[arg(long)]
    payload: Option<String>,

    /// Output JSON path.
    #[arg(short, long)]
    output: PathBuf,
}

#[derive(Parser)]
struct InspectArgs {
    /// Path to a packet JSON file.
    file: PathBuf,
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Create(args) => run_create(args),
        Command::Inspect(args) => run_inspect(args),
    }
}

fn run_create(args: CreateArgs) -> Result<()> {
    let stack = build_stack(&args)?;
    let doc = assemble(&stack).context("assembling packet")?;
    let json = doc.to_json().context("serializing packet")?;
    std::fs::write(&args.output, &json)
        .with_context(|| format!("writing {}", args.output.display()))?;

    let names: Vec<&str> = stack.iter().map(ProtocolSpec::name).collect();
    println!(
        "Wrote {} ({} bytes) to {}",
        names.join("/"),
        doc.buffer.len(),
        args.output.display()
    );
    print_diagnostics(&doc.diagnostics);
    Ok(())
}

fn run_inspect(args: InspectArgs) -> Result<()> {
    let text = std::fs::read_to_string(&args.file)
        .with_context(|| format!("reading {}", args.file.display()))?;
    let doc = PacketDocument::from_json(&text).context("parsing packet JSON")?;
    print_tree(&doc);
    // Report the current state; never rewrite the bytes.
    print_diagnostics(&validate(&doc));
    Ok(())
}

/// Turn CLI arguments into an ordered protocol stack.
fn build_stack(args: &CreateArgs) -> Result<Vec<ProtocolSpec>> {
    let mut stack = Vec::new();
    for name in &args.protocols {
        let mut spec =
            ProtocolSpec::from_name(name).with_context(|| format!("unknown protocol `{name}`"))?;
        match &mut spec {
            ProtocolSpec::Ethernet(p) => {
                if let Some(m) = &args.src_mac {
                    p.src_mac = parse_mac(m)?;
                }
                if let Some(m) = &args.dst_mac {
                    p.dst_mac = parse_mac(m)?;
                }
            }
            ProtocolSpec::Ipv4(p) => {
                if let Some(ip) = args.src_ip {
                    p.src = ip.octets();
                }
                if let Some(ip) = args.dst_ip {
                    p.dst = ip.octets();
                }
            }
            ProtocolSpec::Tcp(p) => {
                if let Some(v) = args.src_port {
                    p.src_port = v;
                }
                if let Some(v) = args.dst_port {
                    p.dst_port = v;
                }
                if let Some(v) = args.seq {
                    p.seq = v;
                }
                if let Some(f) = &args.flags {
                    p.flags = parse_flags(f)?;
                }
            }
            ProtocolSpec::Raw(data) => {
                if let Some(text) = &args.payload {
                    *data = text.clone().into_bytes();
                }
            }
        }
        stack.push(spec);
    }

    // A payload given without an explicit `raw` layer is appended automatically.
    let has_raw = stack.iter().any(|s| matches!(s, ProtocolSpec::Raw(_)));
    if let Some(text) = &args.payload {
        if !has_raw {
            stack.push(ProtocolSpec::Raw(text.clone().into_bytes()));
        }
    }

    Ok(stack)
}

fn parse_mac(s: &str) -> Result<[u8; 6]> {
    let parts: Vec<&str> = s.split([':', '-']).collect();
    if parts.len() != 6 {
        bail!("MAC address must have 6 octets: `{s}`");
    }
    let mut mac = [0u8; 6];
    for (i, part) in parts.iter().enumerate() {
        mac[i] = u8::from_str_radix(part, 16).with_context(|| format!("bad MAC octet `{part}`"))?;
    }
    Ok(mac)
}

fn parse_flags(s: &str) -> Result<u8> {
    let mut bits = 0u8;
    for token in s.split([',', '+', '|']) {
        let token = token.trim();
        if token.is_empty() {
            continue;
        }
        bits |= match token.to_ascii_lowercase().as_str() {
            "fin" => tcp::flags::FIN,
            "syn" => tcp::flags::SYN,
            "rst" => tcp::flags::RST,
            "psh" => tcp::flags::PSH,
            "ack" => tcp::flags::ACK,
            other => bail!("unknown TCP flag `{other}`"),
        };
    }
    Ok(bits)
}

fn print_tree(doc: &PacketDocument) {
    println!("Packet: {} bytes", doc.buffer.len());
    for layer in &doc.layers {
        let r = layer.range;
        println!("  {} [{}..{}]", layer.name, r.start_bit / 8, (r.start_bit + r.len_bits + 7) / 8);
        for field in &layer.fields {
            println!(
                "    {:<16} {:<12} = {}{}",
                field.name,
                loc_str(field),
                format_value(doc, field),
                marker(field),
            );
        }
    }
}

fn loc_str(field: &Field) -> String {
    let r = field.range;
    if r.start_bit % 8 == 0 && r.len_bits % 8 == 0 {
        format!("[{}..{}]", r.start_bit / 8, (r.start_bit + r.len_bits) / 8)
    } else {
        format!("bit[{}..{}]", r.start_bit, r.start_bit + r.len_bits)
    }
}

fn marker(field: &Field) -> &'static str {
    if field.override_bytes.is_some() {
        " (pinned)"
    } else if field.derivation.is_some() {
        " (derived)"
    } else {
        ""
    }
}

fn format_value(doc: &PacketDocument, field: &Field) -> String {
    let buf = &doc.buffer;
    match field.kind {
        FieldKind::MacAddr => match buf.read_bytes(field.range) {
            Ok(b) => b.iter().map(|x| format!("{x:02x}")).collect::<Vec<_>>().join(":"),
            Err(_) => "<out-of-bounds>".into(),
        },
        FieldKind::Ipv4Addr => match buf.read_bytes(field.range) {
            Ok(b) => b.iter().map(|x| x.to_string()).collect::<Vec<_>>().join("."),
            Err(_) => "<out-of-bounds>".into(),
        },
        FieldKind::Uint => match buf.read_uint(field.range) {
            Ok(v) => v.to_string(),
            Err(_) => "<out-of-bounds>".into(),
        },
        FieldKind::Flags => match buf.read_uint(field.range) {
            Ok(v) => format!("0x{v:02x}"),
            Err(_) => "<out-of-bounds>".into(),
        },
        FieldKind::Bytes => match buf.read_bytes(field.range) {
            Ok(b) => {
                let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
                if hex.len() > 32 { format!("{}…", &hex[..32]) } else { hex }
            }
            Err(_) => "<out-of-bounds>".into(),
        },
    }
}

fn print_diagnostics(diags: &[Diagnostic]) {
    if diags.is_empty() {
        println!("Diagnostics: none");
        return;
    }
    println!("Diagnostics ({}):", diags.len());
    for d in diags {
        let sev = match d.severity {
            Severity::Info => "info",
            Severity::Warning => "warn",
            Severity::Error => "error",
        };
        println!("  [{sev}] {}: {}", d.code, d.message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_colon_mac() {
        assert_eq!(parse_mac("de:ad:be:ef:00:01").unwrap(), [0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01]);
    }

    #[test]
    fn parses_dash_mac() {
        assert_eq!(parse_mac("aa-bb-cc-dd-ee-ff").unwrap(), [0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF]);
    }

    #[test]
    fn rejects_short_mac() {
        assert!(parse_mac("de:ad:be").is_err());
    }

    #[test]
    fn parses_combined_flags() {
        assert_eq!(parse_flags("syn,ack").unwrap(), tcp::flags::SYN | tcp::flags::ACK);
    }

    #[test]
    fn rejects_unknown_flag() {
        assert!(parse_flags("syn,bogus").is_err());
    }
}
