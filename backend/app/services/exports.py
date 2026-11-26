from datetime import datetime, timezone
import io
from typing import Any
from xml.sax.saxutils import escape

from dateutil import parser as dt_parser
import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _parse_log_timestamp(raw_ts: Any) -> datetime:
    """Parse an ISO string or datetime from attendance_logs into a UTC-aware datetime."""
    if isinstance(raw_ts, datetime):
        dt = raw_ts
    elif isinstance(raw_ts, str) and raw_ts.strip():
        dt = dt_parser.isoparse(raw_ts)
    else:
        return datetime.now(timezone.utc)

    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def build_attendance_excel(logs: list[dict[str, Any]]) -> bytes:
    """Build a styled Excel (.xlsx) workbook from attendance tap logs."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Attendance Logs"

    header_font = Font(name="Calibri", bold=True, color="FFFFFF", size=12)
    header_fill = PatternFill(start_color="10B981", end_color="10B981", fill_type="solid")
    header_alignment = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style="thin", color="E2E8F0"),
        right=Side(style="thin", color="E2E8F0"),
        top=Side(style="thin", color="E2E8F0"),
        bottom=Side(style="thin", color="E2E8F0"),
    )
    in_fill = PatternFill(start_color="D1FAE5", end_color="D1FAE5", fill_type="solid")
    out_fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")

    headers = ["#", "Employee ID", "Date", "Time", "Tap Type", "Device Type", "Location"]
    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_num, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
        cell.border = thin_border

    for row_num, log in enumerate(logs, 2):
        tap_type = str(log.get("tap_type") or "").upper()
        tap_display = "CHECK-IN" if tap_type == "IN" else "CHECK-OUT"
        ts = _parse_log_timestamp(log.get("timestamp"))
        row_data = [
            row_num - 1,
            str(log.get("employee_id") or ""),
            ts.strftime("%Y-%m-%d"),
            ts.strftime("%H:%M:%S"),
            tap_display,
            str(log.get("device_type") or ""),
            str(log.get("location") or ""),
        ]
        row_fill = in_fill if tap_type == "IN" else out_fill
        for col_num, value in enumerate(row_data, 1):
            cell = ws.cell(row=row_num, column=col_num, value=value)
            cell.border = thin_border
            cell.fill = row_fill
            cell.alignment = Alignment(
                horizontal="center" if col_num in (1, 5) else "left",
                vertical="center",
            )

    col_widths = [6, 18, 14, 12, 14, 18, 25]
    for idx, width in enumerate(col_widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(idx)].width = width

    ws.freeze_panes = "A2"

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def build_attendance_pdf(reports: list[dict[str, Any]]) -> bytes:
    """Build a landscape PDF report from AI attendance report rows."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(letter))
    styles = getSampleStyleSheet()

    elements: list[Any] = [
        Paragraph("AI Attendance Report", styles["Heading1"]),
        Spacer(1, 20),
    ]

    data: list[list[Any]] = [
        ["Employee Name", "Total Hours", "Leaves Taken", "AI Score", "Agent Feedback"]
    ]
    for report in reports:
        employee_name = str(report.get("employee_name") or report.get("name") or "")
        ai_score = report.get("ai_score")
        score_text = str(ai_score) if ai_score is not None else "N/A"
        feedback_text = escape(str(report.get("ai_feedback") or ""))
        data.append([
            employee_name,
            str(report.get("total_hours", "")),
            str(report.get("leaves_taken", "")),
            score_text,
            Paragraph(feedback_text, styles["Normal"]),
        ])

    table = Table(data, colWidths=[120, 80, 80, 70, 370])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#6366f1")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 12),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 12),
        ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#f1f5f9")),
        ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor("#0a0e1a")),
        ("GRID", (0, 0), (-1, -1), 1, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))

    elements.append(table)
    doc.build(elements)
    return buffer.getvalue()


def build_performance_pdf(records: list[dict[str, Any]]) -> bytes:
    """Build a portrait PDF report from AI performance review records."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, rightMargin=30, leftMargin=30, topMargin=30, bottomMargin=30)
    styles = getSampleStyleSheet()

    title_style = styles["Heading1"]
    sub_style = styles["Heading2"]
    section_style = styles["Heading4"]
    normal_style = styles["Normal"]

    elements: list[Any] = [
        Paragraph("Performance Review Reports (Bulk Generated)", title_style),
        Spacer(1, 20),
    ]

    if not records:
        elements.append(Paragraph("No performance reports available.", normal_style))
    else:
        for record in records:
            emp_name = escape(str(record.get("employee_name") or "Unknown"))
            emp_email = escape(str(record.get("employee_email") or ""))
            review_period = escape(str(record.get("review_period") or ""))
            perf_score = record.get("performance_score")
            score_text = escape(str(perf_score) if perf_score is not None else "N/A")
            kpi_pct = record.get("kpi_achievement_percent")
            kpi_text = escape(str(kpi_pct) if kpi_pct is not None else "N/A")

            strengths = escape(str(record.get("strengths") or "")).replace("\n", "<br/>")
            improvements = escape(str(record.get("areas_for_improvement") or "")).replace("\n", "<br/>")
            actions = escape(str(record.get("recommended_actions") or "")).replace("\n", "<br/>")

            elements.append(Paragraph(f"Employee: {emp_name} ({emp_email})", sub_style))
            elements.append(Paragraph(f"Review Period: {review_period}", normal_style))
            elements.append(Paragraph(f"AI Performance Score: {score_text}/100", normal_style))
            elements.append(Paragraph(f"KPI Achievement: {kpi_text}%", normal_style))

            elements.append(Spacer(1, 10))
            elements.append(Paragraph("Strengths:", section_style))
            elements.append(Paragraph(strengths or "None recorded.", normal_style))

            elements.append(Spacer(1, 10))
            elements.append(Paragraph("Areas for Improvement:", section_style))
            elements.append(Paragraph(improvements or "None recorded.", normal_style))

            elements.append(Spacer(1, 10))
            elements.append(Paragraph("Recommended Actions:", section_style))
            elements.append(Paragraph(actions or "None recorded.", normal_style))

            elements.append(Spacer(1, 30))

    doc.build(elements)
    return buffer.getvalue()
