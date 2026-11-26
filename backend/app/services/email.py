from email.message import EmailMessage
import logging
import smtplib

from app.config import get_settings

logger = logging.getLogger(__name__)


def get_email_mode() -> str:
    """Return 'smtp' when SMTP credentials are configured, else 'console'."""
    settings = get_settings()
    if settings.SMTP_HOST and settings.SMTP_USER:
        return "smtp"
    return "console"


def send_interview_email(to_email: str, subject: str, body: str) -> dict[str, str]:
    """Send interview invitation via SMTP when configured, else log cleanly to console."""
    settings = get_settings()
    if settings.SMTP_HOST and settings.SMTP_USER:
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = settings.SMTP_FROM_EMAIL
        msg["To"] = to_email
        msg.set_content(body)

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as server:
            server.starttls()
            if settings.SMTP_PASSWORD:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(msg)

        logger.info("EmailMode=smtp Sent interview email to %s", to_email)
        return {"status": "sent", "mode": "smtp", "to": to_email}

    logger.info(
        'EmailMode="console" To=%s Subject=%r Body=%s',
        to_email,
        subject,
        body.replace("\n", " ")[:200],
    )
    return {"status": "sent", "mode": "console", "to": to_email}
