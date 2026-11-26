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
    """Parse an ISO string or datetime into a UTC-aware datetime, falling back to now."""
    if isinstance(raw_ts, datetime):
        dt = raw_ts
    elif isinstance(raw_ts, str) and raw_ts.strip():
        try:
            dt = dt_parser.isoparse(raw_ts.strip())
        except (ValueError, OverflowError, TypeError):
            return datetime.now(timezone.utc)
    else:
        return datetime.now(timezone.utc)

    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def parse_utc_timestamp(raw_ts: Any) -> datetime:
    """Public alias for UTC-normalizing timestamp parser."""
    return _parse_log_timestamp(raw_ts)


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


def build_recruitment_excel(job: dict[str, Any], candidates: list[dict[str, Any]]) -> bytes:
    """Build a styled Excel (.xlsx) report of screened candidates for a job posting."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Candidates"

    header_font = Font(name="Calibri", bold=True, color="FFFFFF", size=12)
    header_fill = PatternFill(start_color="1F48D9", end_color="1F48D9", fill_type="solid")
    header_alignment = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style="thin", color="E2E8F0"),
        right=Side(style="thin", color="E2E8F0"),
        top=Side(style="thin", color="E2E8F0"),
        bottom=Side(style="thin", color="E2E8F0"),
    )

    ws.cell(row=1, column=1, value=f"Job Posting: {job.get('title', 'Untitled')}").font = Font(
        name="Calibri", bold=True, size=13, color="1E293B"
    )
    ws.cell(
        row=2,
        column=1,
        value=f"Department: {job.get('department', 'Engineering')} | Required Skills: {job.get('required_skills', '')}",
    ).font = Font(name="Calibri", size=10, color="64748B")

    headers = ["#", "Candidate Name", "Email", "Match Score (%)", "Matched Skills", "Interview Slot", "Status", "Email Sent"]
    header_row = 4
    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=header_row, column=col_num, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
        cell.border = thin_border
    ws.row_dimensions[header_row].height = 28

    for idx, cand in enumerate(candidates, 1):
        row_idx = header_row + idx
        values = [
            idx,
            str(cand.get("name") or "Unknown"),
            str(cand.get("email") or "N/A"),
            round(float(cand.get("match_score", 0.0) or 0.0), 1),
            str(cand.get("matched_skills") or ""),
            str(cand.get("interview_slot") or "TBD"),
            str(cand.get("status") or ""),
            "Yes" if cand.get("email_sent") else "No",
        ]
        for col_num, val in enumerate(values, 1):
            cell = ws.cell(row=row_idx, column=col_num, value=val)
            cell.border = thin_border
            cell.alignment = Alignment(
                horizontal="center" if col_num in (1, 4, 7, 8) else "left",
                vertical="center",
            )

    widths = [6, 24, 28, 16, 36, 30, 16, 12]
    for col_num, width in enumerate(widths, 1):
        col_letter = openpyxl.utils.get_column_letter(col_num)
        ws.column_dimensions[col_letter].width = width

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


def build_sample_attendance_timesheet_excel() -> bytes:
    """Build a realistic sample Excel (.xlsx) timesheet for testing AI attendance analysis."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Timesheet"

    headers = ["Employee Name", "Working Date", "Login Time", "Logout Time"]
    header_font = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="0D9488", end_color="0D9488", fill_type="solid")
    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_num, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")

    sample_rows = [
        ("Ananya Iyer", "2026-11-23", "09:30", "18:15"),
        ("Ananya Iyer", "2026-11-24", "09:25", "18:05"),
        ("Ananya Iyer", "2026-11-25", "09:35", "18:30"),
        ("Rohan Kulkarni", "2026-11-23", "09:45", "18:00"),
        ("Rohan Kulkarni", "2026-11-24", "", ""),
        ("Rohan Kulkarni", "2026-11-25", "09:40", "18:10"),
        ("Priya Sharma", "2026-11-23", "09:15", "18:45"),
        ("Priya Sharma", "2026-11-24", "09:20", "18:30"),
        ("Priya Sharma", "2026-11-25", "09:30", "18:20"),
    ]
    for row_idx, row_vals in enumerate(sample_rows, 2):
        for col_num, val in enumerate(row_vals, 1):
            ws.cell(row=row_idx, column=col_num, value=val)

    for col_num, width in enumerate([22, 16, 14, 14], 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(col_num)].width = width

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


def build_attendance_report_excel(reports: list[dict[str, Any]]) -> bytes:
    """Build a styled Excel (.xlsx) workbook from AI attendance report rows."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "AI Attendance Report"

    header_font = Font(name="Calibri", bold=True, color="FFFFFF", size=12)
    header_fill = PatternFill(start_color="0D9488", end_color="0D9488", fill_type="solid")
    thin_border = Border(
        left=Side(style="thin", color="E2E8F0"),
        right=Side(style="thin", color="E2E8F0"),
        top=Side(style="thin", color="E2E8F0"),
        bottom=Side(style="thin", color="E2E8F0"),
    )

    headers = ["#", "Employee Name", "Total Hours", "Leaves Taken", "AI Score (/100)", "Agent Feedback"]
    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_num, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = thin_border
    ws.row_dimensions[1].height = 28

    for idx, row in enumerate(reports, 1):
        row_idx = idx + 1
        score = row.get("ai_score")
        values = [
            idx,
            str(row.get("employee_name") or "Unknown"),
            round(float(row.get("total_hours", 0.0) or 0.0), 2),
            int(row.get("leaves_taken", 0) or 0),
            int(score) if score is not None else "N/A",
            str(row.get("ai_feedback") or ""),
        ]
        for col_num, val in enumerate(values, 1):
            cell = ws.cell(row=row_idx, column=col_num, value=val)
            cell.border = thin_border
            cell.alignment = Alignment(
                horizontal="center" if col_num in (1, 3, 4, 5) else "left",
                vertical="center",
                wrap_text=(col_num == 6),
            )

    for col_num, width in enumerate([6, 24, 15, 15, 16, 55], 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(col_num)].width = width

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


def build_sample_performance_kpi_excel() -> bytes:
    """Build a realistic sample Excel (.xlsx) KPI sheet for testing bulk AI performance reviews."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "KPI Data"

    headers = [
        "Employee Name",
        "Email",
        "Department",
        "Tasks Completed",
        "Target Tasks",
        "Quality Score",
        "Collaboration",
    ]
    header_font = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="1F48D9", end_color="1F48D9", fill_type="solid")
    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_num, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")

    rows = [
        ("Rohan Kulkarni", "rohan@company.com", "Engineering", 46, 45, "94%", "Mentored 2 junior engineers in Bengaluru squad"),
        ("Priya Nair", "priya.nair@company.com", "Product", 42, 45, "91%", "Led UPI & payment gateway API migration"),
        ("Vikram Deshmukh", "vikram.d@company.com", "Engineering", 38, 40, "88%", "Shipped Q3 onboarding flow ahead of schedule"),
    ]
    for row_idx, row_vals in enumerate(rows, 2):
        for col_num, val in enumerate(row_vals, 1):
            ws.cell(row=row_idx, column=col_num, value=val)

    for col_num, width in enumerate([20, 28, 16, 16, 14, 14, 30], 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(col_num)].width = width

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


def build_performance_excel(records: list[dict[str, Any]]) -> bytes:
    """Build a styled Excel (.xlsx) workbook from AI performance review records."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Performance Reports"

    header_font = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="1F48D9", end_color="1F48D9", fill_type="solid")
    thin_border = Border(
        left=Side(style="thin", color="E2E8F0"),
        right=Side(style="thin", color="E2E8F0"),
        top=Side(style="thin", color="E2E8F0"),
        bottom=Side(style="thin", color="E2E8F0"),
    )

    headers = [
        "#",
        "Employee Name",
        "Email",
        "Department",
        "Review Period",
        "AI Score (/100)",
        "KPI Achievement (%)",
        "Key Strengths",
        "Areas for Improvement",
        "Recommended Actions",
    ]
    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_num, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = thin_border
    ws.row_dimensions[1].height = 28

    for idx, rec in enumerate(records, 1):
        row_idx = idx + 1
        score = rec.get("performance_score")
        kpi = rec.get("kpi_achievement_percent")
        values = [
            idx,
            str(rec.get("employee_name") or "Unknown"),
            str(rec.get("employee_email") or ""),
            str(rec.get("department") or "General"),
            str(rec.get("review_period") or ""),
            int(score) if score is not None else "N/A",
            round(float(kpi), 1) if kpi is not None else "N/A",
            str(rec.get("strengths") or ""),
            str(rec.get("areas_for_improvement") or ""),
            str(rec.get("recommended_actions") or ""),
        ]
        for col_num, val in enumerate(values, 1):
            cell = ws.cell(row=row_idx, column=col_num, value=val)
            cell.border = thin_border
            cell.alignment = Alignment(
                horizontal="center" if col_num in (1, 6, 7) else "left",
                vertical="center",
                wrap_text=(col_num >= 8),
            )

    for col_num, width in enumerate([6, 20, 26, 16, 16, 16, 18, 36, 36, 36], 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(col_num)].width = width

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


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


def build_recruitment_excel(job: dict[str, Any], candidates: list[dict[str, Any]]) -> bytes:
    """Build a styled Excel (.xlsx) report of screened candidates for a job posting."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Candidates"

    header_font = Font(name="Calibri", bold=True, color="FFFFFF", size=12)
    header_fill = PatternFill(start_color="1F48D9", end_color="1F48D9", fill_type="solid")
    header_alignment = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style="thin", color="E2E8F0"),
        right=Side(style="thin", color="E2E8F0"),
        top=Side(style="thin", color="E2E8F0"),
        bottom=Side(style="thin", color="E2E8F0"),
    )

    ws.cell(row=1, column=1, value=f"Job Posting: {job.get('title', 'Untitled')}").font = Font(
        name="Calibri", bold=True, size=13, color="1E293B"
    )
    ws.cell(
        row=2,
        column=1,
        value=f"Department: {job.get('department', 'Engineering')} | Required Skills: {job.get('required_skills', '')}",
    ).font = Font(name="Calibri", size=10, color="64748B")

    headers = ["#", "Candidate Name", "Email", "Match Score (%)", "Matched Skills", "Interview Slot", "Status", "Email Sent"]
    header_row = 4
    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=header_row, column=col_num, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
        cell.border = thin_border
    ws.row_dimensions[header_row].height = 28

    for idx, cand in enumerate(candidates, 1):
        row_idx = header_row + idx
        values = [
            idx,
            str(cand.get("name") or "Unknown"),
            str(cand.get("email") or "N/A"),
            round(float(cand.get("match_score", 0.0) or 0.0), 1),
            str(cand.get("matched_skills") or ""),
            str(cand.get("interview_slot") or "TBD"),
            str(cand.get("status") or ""),
            "Yes" if cand.get("email_sent") else "No",
        ]
        for col_num, val in enumerate(values, 1):
            cell = ws.cell(row=row_idx, column=col_num, value=val)
            cell.border = thin_border
            cell.alignment = Alignment(
                horizontal="center" if col_num in (1, 4, 7, 8) else "left",
                vertical="center",
            )

    widths = [6, 24, 28, 16, 36, 30, 16, 12]
    for col_num, width in enumerate(widths, 1):
        col_letter = openpyxl.utils.get_column_letter(col_num)
        ws.column_dimensions[col_letter].width = width

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


def build_sample_attendance_timesheet_excel() -> bytes:
    """Build a realistic sample Excel (.xlsx) timesheet for testing AI attendance analysis."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Timesheet"

    headers = ["Employee Name", "Working Date", "Login Time", "Logout Time"]
    header_font = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="0D9488", end_color="0D9488", fill_type="solid")
    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_num, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")

    sample_rows = [
        ("Ananya Iyer", "2026-11-23", "09:30", "18:15"),
        ("Ananya Iyer", "2026-11-24", "09:25", "18:05"),
        ("Ananya Iyer", "2026-11-25", "09:35", "18:30"),
        ("Rohan Kulkarni", "2026-11-23", "09:45", "18:00"),
        ("Rohan Kulkarni", "2026-11-24", "", ""),
        ("Rohan Kulkarni", "2026-11-25", "09:40", "18:10"),
        ("Priya Sharma", "2026-11-23", "09:15", "18:45"),
        ("Priya Sharma", "2026-11-24", "09:20", "18:30"),
        ("Priya Sharma", "2026-11-25", "09:30", "18:20"),
    ]
    for row_idx, row_vals in enumerate(sample_rows, 2):
        for col_num, val in enumerate(row_vals, 1):
            ws.cell(row=row_idx, column=col_num, value=val)

    for col_num, width in enumerate([22, 16, 14, 14], 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(col_num)].width = width

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


def build_attendance_report_excel(reports: list[dict[str, Any]]) -> bytes:
    """Build a styled Excel (.xlsx) workbook from AI attendance report rows."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "AI Attendance Report"

    header_font = Font(name="Calibri", bold=True, color="FFFFFF", size=12)
    header_fill = PatternFill(start_color="0D9488", end_color="0D9488", fill_type="solid")
    thin_border = Border(
        left=Side(style="thin", color="E2E8F0"),
        right=Side(style="thin", color="E2E8F0"),
        top=Side(style="thin", color="E2E8F0"),
        bottom=Side(style="thin", color="E2E8F0"),
    )

    headers = ["#", "Employee Name", "Total Hours", "Leaves Taken", "AI Score (/100)", "Agent Feedback"]
    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_num, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = thin_border
    ws.row_dimensions[1].height = 28

    for idx, row in enumerate(reports, 1):
        row_idx = idx + 1
        score = row.get("ai_score")
        values = [
            idx,
            str(row.get("employee_name") or "Unknown"),
            round(float(row.get("total_hours", 0.0) or 0.0), 2),
            int(row.get("leaves_taken", 0) or 0),
            int(score) if score is not None else "N/A",
            str(row.get("ai_feedback") or ""),
        ]
        for col_num, val in enumerate(values, 1):
            cell = ws.cell(row=row_idx, column=col_num, value=val)
            cell.border = thin_border
            cell.alignment = Alignment(
                horizontal="center" if col_num in (1, 3, 4, 5) else "left",
                vertical="center",
                wrap_text=(col_num == 6),
            )

    for col_num, width in enumerate([6, 24, 15, 15, 16, 55], 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(col_num)].width = width

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


def build_sample_performance_kpi_excel() -> bytes:
    """Build a realistic sample Excel (.xlsx) KPI sheet for testing bulk AI performance reviews."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "KPI Data"

    headers = [
        "Employee Name",
        "Email",
        "Department",
        "Tasks Completed",
        "Target Tasks",
        "Quality Score",
        "Collaboration",
    ]
    header_font = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="1F48D9", end_color="1F48D9", fill_type="solid")
    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_num, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")

    rows = [
        ("Rohan Kulkarni", "rohan@company.com", "Engineering", 46, 45, "94%", "Mentored 2 junior engineers in Bengaluru squad"),
        ("Priya Nair", "priya.nair@company.com", "Product", 42, 45, "91%", "Led UPI & payment gateway API migration"),
        ("Vikram Deshmukh", "vikram.d@company.com", "Engineering", 38, 40, "88%", "Shipped Q3 onboarding flow ahead of schedule"),
    ]
    for row_idx, row_vals in enumerate(rows, 2):
        for col_num, val in enumerate(row_vals, 1):
            ws.cell(row=row_idx, column=col_num, value=val)

    for col_num, width in enumerate([20, 28, 16, 16, 14, 14, 30], 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(col_num)].width = width

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


def build_performance_excel(records: list[dict[str, Any]]) -> bytes:
    """Build a styled Excel (.xlsx) workbook from AI performance review records."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Performance Reports"

    header_font = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="1F48D9", end_color="1F48D9", fill_type="solid")
    thin_border = Border(
        left=Side(style="thin", color="E2E8F0"),
        right=Side(style="thin", color="E2E8F0"),
        top=Side(style="thin", color="E2E8F0"),
        bottom=Side(style="thin", color="E2E8F0"),
    )

    headers = [
        "#",
        "Employee Name",
        "Email",
        "Department",
        "Review Period",
        "AI Score (/100)",
        "KPI Achievement (%)",
        "Key Strengths",
        "Areas for Improvement",
        "Recommended Actions",
    ]
    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_num, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = thin_border
    ws.row_dimensions[1].height = 28

    for idx, rec in enumerate(records, 1):
        row_idx = idx + 1
        score = rec.get("performance_score")
        kpi = rec.get("kpi_achievement_percent")
        values = [
            idx,
            str(rec.get("employee_name") or "Unknown"),
            str(rec.get("employee_email") or ""),
            str(rec.get("department") or "General"),
            str(rec.get("review_period") or ""),
            int(score) if score is not None else "N/A",
            round(float(kpi), 1) if kpi is not None else "N/A",
            str(rec.get("strengths") or ""),
            str(rec.get("areas_for_improvement") or ""),
            str(rec.get("recommended_actions") or ""),
        ]
        for col_num, val in enumerate(values, 1):
            cell = ws.cell(row=row_idx, column=col_num, value=val)
            cell.border = thin_border
            cell.alignment = Alignment(
                horizontal="center" if col_num in (1, 6, 7) else "left",
                vertical="center",
                wrap_text=(col_num >= 8),
            )

    for col_num, width in enumerate([6, 20, 26, 16, 16, 16, 18, 36, 36, 36], 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(col_num)].width = width

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()
