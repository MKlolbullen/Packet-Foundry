//! `packet-foundry` — the command-line assembler.
//!
//! `create` builds a packet from an ordered protocol stack and writes it as JSON. `inspect` loads
//! a packet JSON and prints its structure plus freshly-computed diagnostics (it reports problems,
//! it does not fix them).

use std::net::Ipv4Addr;
use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use packet_core::{BitRange, Diagnostic, Field, PacketDocument, Severity};
use protocol_engine::diff::{FieldChange, FieldDiff, LayerStatus, PacketDiff};
use protocol_engine::protocols::tcp;
use protocol_engine::{ProtocolSpec, assemble, diff, format_field_value, validate};

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
    /// Compare two packet JSONs and print a causal diff (direct edits vs. derived consequences).
    Diff(DiffArgs),
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
    /// ICMP message type (default 8 = echo request).
    #[arg(long)]
    icmp_type: Option<u8>,
    /// ICMP code (default 0).
    #[arg(long)]
    icmp_code: Option<u8>,

    /// Output JSON path.
    #[arg(short, long)]
    output: PathBuf,
}

#[derive(Parser)]
struct InspectArgs {
    /// Path to a packet JSON file.
    file: PathBuf,
}

#[derive(Parser)]
struct DiffArgs {
    /// The base packet JSON (the "before").
    base: PathBuf,
    /// The variant packet JSON (the "after").
    variant: PathBuf,
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Create(args) => run_create(args),
        Command::Inspect(args) => run_inspect(args),
        Command::Diff(args) => run_diff(args),
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

fn load_doc(path: &std::path::Path) -> Result<PacketDocument> {
    let text = std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    let mut doc = PacketDocument::from_json(&text).context("parsing packet JSON")?;
    doc.assign_missing_node_ids();
    Ok(doc)
}

fn run_diff(args: DiffArgs) -> Result<()> {
    let mut base = load_doc(&args.base)?;
    let mut variant = load_doc(&args.variant)?;
    // Refresh diagnostics on both so docs produced by different means compare fairly (like inspect).
    base.diagnostics = validate(&base);
    variant.diagnostics = validate(&variant);
    print_diff(&diff(&base, &variant), &args.base, &args.variant);
    Ok(())
}

fn print_diff(d: &PacketDiff, base: &std::path::Path, variant: &std::path::Path) {
    println!("Diff: {} → {}", base.display(), variant.display());
    let mut any = false;
    for layer in &d.layers {
        match layer.status {
            LayerStatus::Added => {
                println!("  + {} (added)", layer.name);
                for f in &layer.fields_added {
                    println!("      + {:<16} = {}", f.name, f.value);
                }
                any = true;
            }
            LayerStatus::Removed => {
                println!("  - {} (removed)", layer.name);
                any = true;
            }
            LayerStatus::Modified => {
                println!("  ~ {}", layer.name);
                for f in &layer.fields_removed {
                    println!("      - {:<16} = {}", f.name, f.value);
                }
                for f in &layer.fields_added {
                    println!("      + {:<16} = {}", f.name, f.value);
                }
                for f in &layer.fields_changed {
                    print_field_diff(f);
                }
                any = true;
            }
            LayerStatus::Unchanged => {}
        }
    }
    if !any {
        println!("  (no structural changes)");
    }

    if !d.diagnostics.added.is_empty() || !d.diagnostics.removed.is_empty() {
        println!("Diagnostics:");
        for dg in &d.diagnostics.removed {
            println!("  - [{}] {}", dg.code, dg.message);
        }
        for dg in &d.diagnostics.added {
            println!("  + [{}] {}", dg.code, dg.message);
        }
    }

    let ranges: Vec<String> = d.bytes.changed.iter().map(|r| format!("[{}..{}]", r.start, r.end)).collect();
    println!(
        "Bytes: {}; length {} → {}",
        if ranges.is_empty() { "none".to_string() } else { ranges.join(" ") },
        d.bytes.len_before,
        d.bytes.len_after,
    );
}

fn print_field_diff(f: &FieldDiff) {
    let causal = match f.change {
        FieldChange::DirectEdit => "(direct edit)",
        FieldChange::DerivedConsequence => "(derived consequence)",
        FieldChange::StateOnly => "(state change)",
        FieldChange::Unchanged => "",
    };
    let range = loc_str(f.range_after);
    if f.change == FieldChange::StateOnly {
        println!(
            "      ~ {:<16} {:<12} state: {:?} → {:?}  {causal}",
            f.name, range, f.state_before, f.state_after,
        );
    } else {
        println!(
            "      ~ {:<16} {:<12} {} → {}  {causal}",
            f.name, range, f.value_before, f.value_after,
        );
    }
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
            // IPv6 uses 16-byte addresses that the current --src-ip/--dst-ip (IPv4) flags can't
            // express; assemble it with defaults, or set fields via the desktop stack JSON.
            ProtocolSpec::Ipv6(_) => {}
            // VLAN priority/id and ICMPv6 type/code have no dedicated CLI flags yet; assemble with
            // defaults, or set fields via the desktop stack JSON.
            ProtocolSpec::Vlan(_) => {}
            ProtocolSpec::Icmpv6(p) => {
                if let Some(v) = args.icmp_type {
                    p.icmp_type = v;
                }
                if let Some(v) = args.icmp_code {
                    p.code = v;
                }
            }
            ProtocolSpec::Arp(p) => {
                if let Some(m) = &args.src_mac {
                    p.sender_mac = parse_mac(m)?;
                }
                if let Some(m) = &args.dst_mac {
                    p.target_mac = parse_mac(m)?;
                }
                if let Some(ip) = args.src_ip {
                    p.sender_ip = ip.octets();
                }
                if let Some(ip) = args.dst_ip {
                    p.target_ip = ip.octets();
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
            ProtocolSpec::Udp(p) => {
                if let Some(v) = args.src_port {
                    p.src_port = v;
                }
                if let Some(v) = args.dst_port {
                    p.dst_port = v;
                }
            }
            ProtocolSpec::Icmp(p) => {
                if let Some(v) = args.icmp_type {
                    p.icmp_type = v;
                }
                if let Some(v) = args.icmp_code {
                    p.code = v;
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
        println!("  {} [{}..{}]", layer.name, r.start_bit / 8, (r.start_bit + r.len_bits).div_ceil(8));
        for field in &layer.fields {
            println!(
                "    {:<16} {:<12} = {}{}",
                field.name,
                loc_str(field.range),
                format_field_value(&doc.buffer, field),
                marker(field),
            );
        }
    }
}

fn loc_str(r: BitRange) -> String {
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
