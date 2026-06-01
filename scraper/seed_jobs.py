#!/usr/bin/env python3
"""Generate a realistic SAMPLE jobs.json so the Live Jobs module works on day one,
before API keys are added. Marked source='Sample' so real runs replace it.
Run once: python3 seed_jobs.py
"""
import json, os
from datetime import datetime, timezone, timedelta
import scrape as s

CFG = s.load_config()
now = datetime.now(timezone.utc)

RAW = [
    ("Turnaround / Shutdown Planner (Primavera P6)", "Petro Rabigh", "Yanbu, Saudi Arabia",
     "Lead planning for the 2026 refinery turnaround. Build and maintain the P6 schedule, integrate scope from mechanical, static and rotating equipment teams, manage critical path and resource leveling. 10+ years oil and gas shutdown planning. CV to careers-tar@petrorabigh-demo.com", "operator/epc"),
    ("Senior Static Equipment Inspector (API 510 / 570)", "ADNOC Refining", "Ruwais, United Arab Emirates",
     "Pressure vessels, heat exchangers and piping inspection during planned shutdown. API 510, API 570 and CSWIP 3.1 required. Rope access (IRATA) preferred. Asset integrity and corrosion experience essential.", "operator/epc"),
    ("Rotating Equipment Engineer — Turnaround", "QatarEnergy LNG", "Ras Laffan, Qatar",
     "Support major maintenance on compressors, pumps and turbines. Mechanical completion and pre-commissioning. LNG / gas processing background. H2S and confined space certified.", "operator/epc"),
    ("QA/QC Welding Inspector (CSWIP 3.1)", "Petrofac", "Jubail, Saudi Arabia",
     "Welding inspection and NDT coordination for petrochemical shutdown. CSWIP / BGAS. Fabrication and tie-in experience. Contact: recruitment@petrofac-demo.com", "operator/epc"),
    ("HSE Officer — Shutdown (NEBOSH)", "Worley", "Al Khobar, Saudi Arabia",
     "Permit to work, confined space and HSE supervision during plant shutdown. NEBOSH IGC required. H2S awareness. Oil and gas site experience.", "operator/epc"),
    ("Commissioning Lead — Electrical & Instrumentation", "McDermott", "Abu Dhabi, United Arab Emirates",
     "Pre-commissioning and commissioning of E&I systems on an offshore hook-up and tie-in campaign. DCS / PLC / SCADA. EPC environment.", "operator/epc"),
    ("Piping Superintendent (Construction)", "KBR", "Doha, Qatar",
     "Supervise piping construction and tie-ins for gas processing expansion. Flange management, fabrication, field engineering. 12+ years onshore oil and gas.", "operator/epc"),
    ("Maintenance Planner — CMMS / Maximo", "SABIC", "Jubail, Saudi Arabia",
     "Planned and turnaround maintenance planning using Maximo and Primavera P6. Static and rotating equipment. Petrochemical plant.", "operator/epc"),
    ("Scaffolding & Rigging Supervisor", "Sprint Energy Services", "Dammam, Saudi Arabia",
     "Supervise scaffolding and rigging crews during refinery turnaround. Working at height and lifting plans. Shutdown / outage experience essential.", "service"),
    ("Process Engineer — Refinery", "ADNOC", "Abu Dhabi, United Arab Emirates",
     "Process engineering support for refinery operations and turnaround scope definition. Downstream / petrochemical. Process safety.", "operator/epc"),
    ("NDT Technician (Rope Access)", "Applus+ Velosi", "Sharjah, United Arab Emirates",
     "NDT and rope access inspection for asset integrity and shutdown campaigns. PCN / level II. Cathodic protection a plus.", "service"),
    ("Cost Control Engineer — EPC Project", "Hyundai E&C", "Ras Laffan, Qatar",
     "Cost control, estimation and procurement support on an EPC gas project. Primavera P6 interface. Contracts experience.", "operator/epc"),
    ("Cloud Solutions Architect", "e& (Etisalat)", "Dubai, United Arab Emirates",
     "AWS / Kubernetes / Terraform architect for a telco digital platform. Python and SQL. (Non oil-and-gas — included to show cross-industry matching.)", "unknown"),
]

jobs = []
for i, (title, company, loc, desc, ctype) in enumerate(RAW):
    j = s.normalize(source="Sample", title=title, company=company, location=loc,
                    description=desc, url=f"https://example.com/jobs/{i+1}",
                    company_type=ctype, posted=(now - timedelta(days=i % 9)).isoformat(),
                    cfg=CFG)
    seen = (now - timedelta(days=i % 9)).isoformat()
    j["first_seen"] = seen
    j["last_seen"] = now.isoformat()
    jobs.append(j)

target = set(CFG["target_countries"])
payload = {
    "generated_at": now.isoformat(),
    "count": len(jobs),
    "shutdown_count": sum(1 for j in jobs if j["shutdown"]),
    "by_country": {c: sum(1 for j in jobs if j["country"] == c) for c in target},
    "sources": ["Sample (placeholder data — replaced on first live run)"],
    "jobs": jobs,
}
s.write_outputs(payload)
print(f"Wrote {len(jobs)} sample jobs ({payload['shutdown_count']} shutdown) to jobs.json + jobs.js")
