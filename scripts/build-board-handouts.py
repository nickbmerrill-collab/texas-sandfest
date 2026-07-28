#!/usr/bin/env python3

from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output" / "pdf"
DECISION_PATH = OUTPUT_DIR / "SandFest-Board-Decision-Brief.pdf"
FLIGHT_PATH = OUTPUT_DIR / "SandFest-Presenter-Flight-Card.pdf"

INK = HexColor("#103B3A")
GULF = HexColor("#0B4A47")
DEEP_GULF = HexColor("#073633")
CORAL = HexColor("#E76A4B")
SAND = HexColor("#F4E5C5")
PALE_SAND = HexColor("#FBF6EB")
AQUA = HexColor("#A9DCD4")
MIST = HexColor("#EAF3F0")
SLATE = HexColor("#496462")
LINE = HexColor("#D3DDD8")

FONT_DIR = Path("/System/Library/Fonts/Supplemental")
pdfmetrics.registerFont(TTFont("SandfestSans", str(FONT_DIR / "Arial.ttf")))
pdfmetrics.registerFont(TTFont("SandfestSansBold", str(FONT_DIR / "Arial Bold.ttf")))
pdfmetrics.registerFont(TTFont("SandfestSerif", str(FONT_DIR / "Georgia.ttf")))
pdfmetrics.registerFont(TTFont("SandfestSerifBold", str(FONT_DIR / "Georgia Bold.ttf")))
pdfmetrics.registerFont(TTFont("SandfestSerifItalic", str(FONT_DIR / "Georgia Italic.ttf")))

PAGE_W, PAGE_H = letter


def wrapped_lines(text, font_name, font_size, width):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if pdfmetrics.stringWidth(candidate, font_name, font_size) <= width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_wrapped(c, text, x, y, width, font_name="SandfestSans", font_size=9,
                 leading=12, color=INK, max_lines=None):
    lines = wrapped_lines(text, font_name, font_size, width)
    if max_lines is not None:
        lines = lines[:max_lines]
    c.setFont(font_name, font_size)
    c.setFillColor(color)
    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y


def draw_label(c, text, x, y, color=CORAL):
    c.setFillColor(color)
    c.setFont("SandfestSansBold", 7.5)
    c.drawString(x, y, text.upper())


def draw_checkbox(c, x, y, size=9):
    c.setStrokeColor(GULF)
    c.setLineWidth(1)
    c.roundRect(x, y - size + 2, size, size, 1.5, stroke=1, fill=0)


def draw_bullet(c, text, x, y, width, accent=CORAL, font_size=8.8, leading=11.2):
    c.setFillColor(accent)
    c.circle(x + 3, y - 2.5, 2.2, stroke=0, fill=1)
    return draw_wrapped(c, text, x + 12, y, width - 12, font_size=font_size, leading=leading)


def header(c, kicker, title, subtitle, proof=None):
    c.setFillColor(DEEP_GULF)
    c.rect(0, PAGE_H - 178, PAGE_W, 178, stroke=0, fill=1)
    c.setFillColor(CORAL)
    c.rect(0, PAGE_H - 8, PAGE_W, 8, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("SandfestSansBold", 8)
    c.drawString(36, PAGE_H - 34, "TEXAS SANDFEST")
    c.setFont("SandfestSans", 8)
    c.drawRightString(PAGE_W - 36, PAGE_H - 34, kicker.upper())
    c.setFont("SandfestSerifBold", 27)
    c.drawString(36, PAGE_H - 78, title)
    draw_wrapped(c, subtitle, 36, PAGE_H - 101, PAGE_W - 72, font_size=10.5,
                 leading=13, color=white, max_lines=2)
    if proof:
        c.setFillColor(SAND)
        c.roundRect(36, PAGE_H - 154, PAGE_W - 72, 28, 7, stroke=0, fill=1)
        c.setFillColor(INK)
        c.setFont("SandfestSansBold", 8.2)
        c.drawCentredString(PAGE_W / 2, PAGE_H - 144, proof)


def footer(c, left_text):
    c.setStrokeColor(LINE)
    c.line(36, 30, PAGE_W - 36, 30)
    c.setFillColor(SLATE)
    c.setFont("SandfestSans", 6.8)
    c.drawString(36, 18, left_text)
    c.drawRightString(PAGE_W - 36, 18, "Internal board use | July 2026 | 1 of 1")


def build_decision_brief():
    c = canvas.Canvas(str(DECISION_PATH), pagesize=letter, invariant=1)
    c.setTitle("Texas SandFest Board Decision Brief")
    c.setAuthor("Texas SandFest / Heyelab")
    header(
        c,
        "Board decision brief | July 2026",
        "Approve the activation path",
        "A certified festival platform is ready to move into controlled production.",
        "10/10 journeys  |  Chromium 14/14  |  WebKit 14/14  |  12/12 runtime readiness",
    )

    c.setFillColor(PALE_SAND)
    c.rect(0, 0, PAGE_W, PAGE_H - 178, stroke=0, fill=1)

    left_x, left_w = 36, 248
    right_x, right_w = 310, 266
    top_y = PAGE_H - 205

    draw_label(c, "Certified now", left_x, top_y)
    c.setFont("SandfestSerifBold", 16)
    c.setFillColor(INK)
    c.drawString(left_x, top_y - 24, "A working operating platform")
    y = top_y - 48
    ready_items = [
        "Visitor guide, Live Beach, ticket lifecycle, sculptor roster, Passport, voting, and Guest Services.",
        "Sponsor and vendor intake, private partner status, receivables, milestones, branding, compliance, and outreach.",
        "Operations command, document intake, delegated work, incident response, finance exports, and audit evidence.",
        "Reset-safe local provider sandboxes and an offline narrated fallback for the boardroom.",
    ]
    for item in ready_items:
        y = draw_bullet(c, item, left_x, y, left_w)
        y -= 7

    c.setFillColor(MIST)
    c.roundRect(left_x, y - 111, left_w, 105, 8, stroke=0, fill=1)
    draw_label(c, "Controlled production gates", left_x + 14, y - 23, GULF)
    gate_items = [
        "Payments and accounting",
        "Email and safety messaging",
        "Weather, ferry, and camera edge fleet",
        "Identity, Turnstile, DNS, and recovery",
    ]
    gate_y = y - 43
    for item in gate_items:
        gate_y = draw_bullet(c, item, left_x + 14, gate_y, left_w - 28,
                             accent=GULF, font_size=8.2, leading=10)
        gate_y -= 2

    draw_label(c, "Five decisions requested", right_x, top_y)
    decision_y = top_y - 28
    decisions = [
        "Endorse SandFest as the operating hub while retaining proven systems of record.",
        "Approve staged post-board activation and the managed production foundation.",
        "Assign owners for provider accounts, identity, DNS, Apple signing, and recovery.",
        "Authorize collection and review of current finance, partner, schedule, map, permit, and policy sources.",
        "Keep RFID, closed-loop cashless, and unapproved providers deferred until evidence supports activation.",
    ]
    for index, decision in enumerate(decisions, 1):
        draw_checkbox(c, right_x, decision_y + 1)
        c.setFillColor(CORAL)
        c.setFont("SandfestSansBold", 8.3)
        c.drawString(right_x + 16, decision_y, str(index))
        decision_y = draw_wrapped(
            c, decision, right_x + 31, decision_y, right_w - 31,
            font_size=8.5, leading=10.6
        )
        decision_y -= 12

    draw_label(c, "First 30 days after approval", 36, 286, GULF)
    activation_steps = [
        ("0-10 days", "Assign account and source owners"),
        ("10-20 days", "Load reviewed sources and production foundation"),
        ("20-30 days", "Activate the first provider behind its acceptance gate"),
    ]
    step_width = (PAGE_W - 84) / 3
    for index, (timing, step) in enumerate(activation_steps):
        step_x = 36 + index * (step_width + 6)
        c.setFillColor(white)
        c.roundRect(step_x, 218, step_width, 54, 7, stroke=0, fill=1)
        c.setFillColor(CORAL)
        c.setFont("SandfestSansBold", 7.5)
        c.drawString(step_x + 10, 254, timing.upper())
        draw_wrapped(c, step, step_x + 10, 239, step_width - 20,
                     font_size=7.6, leading=9.2, color=INK, max_lines=3)

    motion_y = 108
    c.setFillColor(GULF)
    c.roundRect(36, motion_y, PAGE_W - 72, 94, 10, stroke=0, fill=1)
    draw_label(c, "Recommended motion", 52, motion_y + 72, AQUA)
    motion = (
        "Approve Texas SandFest as the operating hub and authorize the staged activation plan, "
        "account-owner assignments, and controlled ingestion of current operating sources, while "
        "keeping live providers and higher-risk optional technologies deferred until each gate is accepted."
    )
    draw_wrapped(
        c, motion, 52, motion_y + 52, PAGE_W - 104,
        font_name="SandfestSerifBold", font_size=10.5, leading=14, color=white
    )
    footer(c, "Evidence: capability certificate, board runtime runbook, deploy runbook")
    c.showPage()
    c.save()


def build_flight_card():
    c = canvas.Canvas(str(FLIGHT_PATH), pagesize=letter, invariant=1)
    c.setTitle("Texas SandFest Presenter Flight Card")
    c.setAuthor("Texas SandFest / Heyelab")
    header(
        c,
        "Presenter flight card | Internal",
        "Boardroom route and recovery",
        "Keep the story simple: certified product, controlled activation, five decisions.",
        "Final command: npm run board:showtime",
    )
    c.setFillColor(PALE_SAND)
    c.rect(0, 0, PAGE_W, PAGE_H - 178, stroke=0, fill=1)

    left_x, left_w = 36, 326
    right_x, right_w = 382, 194
    top_y = PAGE_H - 205
    draw_label(c, "18-minute route", left_x, top_y)
    c.setFont("SandfestSerifBold", 16)
    c.setFillColor(INK)
    c.drawString(left_x, top_y - 24, "One story, four movements")

    route = [
        ("0:00-2:00", "Outcome", "Slides 1-3. The platform works; the decision is how to activate it."),
        ("2:00-7:00", "Visitor", "Hero, Live Beach, ticket sandbox, sculptors, Passport, partner intake, Guest Services."),
        ("7:00-13:00", "Operations", "Command summary, document queue, partner operations, incident delegation, capability proof."),
        ("13:00-18:00", "Decision", "Slides 10-12. Name the controlled gates, ask for the five decisions, read the motion."),
    ]
    y = top_y - 54
    for timing, title, detail in route:
        c.setFillColor(white)
        c.roundRect(left_x, y - 65, left_w, 58, 7, stroke=0, fill=1)
        c.setFillColor(CORAL)
        c.setFont("SandfestSansBold", 8)
        c.drawString(left_x + 12, y - 21, timing)
        c.setFillColor(INK)
        c.setFont("SandfestSerifBold", 11)
        c.drawString(left_x + 82, y - 21, title)
        draw_wrapped(c, detail, left_x + 82, y - 37, left_w - 94,
                     font_size=7.7, leading=9.4, color=SLATE, max_lines=3)
        y -= 69

    c.setFillColor(MIST)
    c.roundRect(left_x, 104, left_w, 87, 8, stroke=0, fill=1)
    draw_label(c, "Decision close", left_x + 14, 171, GULF)
    close = (
        "Ask: approve the activation path, assign account owners, and authorize controlled source intake. "
        "Do not ask for blanket approval of live providers, RFID, or closed-loop cashless."
    )
    draw_wrapped(c, close, left_x + 14, 151, left_w - 28,
                 font_name="SandfestSerifBold", font_size=9.2, leading=12, color=INK)

    draw_label(c, "Before the room", right_x, top_y)
    checklist = [
        "Power connected; display and audio tested",
        "Do Not Disturb on; screen sleep disabled",
        "Run board:showtime",
        "Open deck, Visitor, Operations, and video",
        "Keep synthetic-data label visible",
    ]
    checklist_y = top_y - 29
    for item in checklist:
        draw_checkbox(c, right_x, checklist_y + 1, 8)
        checklist_y = draw_wrapped(c, item, right_x + 15, checklist_y,
                                   right_w - 15, font_size=7.8, leading=9.5)
        checklist_y -= 8

    c.setFillColor(SAND)
    c.roundRect(right_x, 305, right_w, 114, 8, stroke=0, fill=1)
    draw_label(c, "If anything drifts", right_x + 12, 398, CORAL)
    recovery = [
        "Do not troubleshoot live in front of the board.",
        "Switch to the narrated fallback video.",
        "Return to the deck for decisions.",
        "Never send, charge, or activate a live provider.",
    ]
    recovery_y = 378
    for item in recovery:
        recovery_y = draw_bullet(c, item, right_x + 12, recovery_y,
                                 right_w - 24, accent=CORAL, font_size=7.6, leading=9.2)
        recovery_y -= 5

    c.setFillColor(GULF)
    c.roundRect(right_x, 104, right_w, 179, 8, stroke=0, fill=1)
    draw_label(c, "Boardroom boundaries", right_x + 12, 262, AQUA)
    boundaries = [
        "Synthetic 2027 data",
        "No external messages",
        "No external charges",
        "No live weather or ferry calls",
        "No live camera feeds",
        "No QuickBooks connection",
    ]
    boundary_y = 242
    c.setFillColor(white)
    for item in boundaries:
        c.circle(right_x + 15, boundary_y - 2, 1.7, stroke=0, fill=1)
        boundary_y = draw_wrapped(c, item, right_x + 23, boundary_y,
                                  right_w - 35, font_size=7.8, leading=9.5, color=white)
        boundary_y -= 6
    footer(c, "Runbook: docs/board-runtime.md | Fallback: artifacts/board-demo")
    c.showPage()
    c.save()


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    build_decision_brief()
    build_flight_card()
    print(DECISION_PATH)
    print(FLIGHT_PATH)


if __name__ == "__main__":
    main()
