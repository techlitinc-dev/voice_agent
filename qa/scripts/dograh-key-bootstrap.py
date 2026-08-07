#!/usr/bin/env python3
"""
QA bootstrap: register the vaani app's DOGRAH_API_KEY in the dograh test DB so
the app's Dograh client (X-API-Key auth) is accepted by the QA dograh instance.

Idempotent: if the org and/or key already exist, it is a no-op.

Usage:
  DOGRAH_KEY=<raw-api-key> python qa/scripts/dograh-key-bootstrap.py
  # or, without the env var, reads DOGRAH_API_KEY from vaani-ai/.env

Requires the dograh venv (it imports api.db clients) and a running test DB
reachable via dograh/api/.env.test.
"""
import asyncio
import hashlib
import os
import sys

from pathlib import Path

DOGRAH_DIR = Path(__file__).resolve().parents[2] / "dograh"
sys.path.insert(0, str(DOGRAH_DIR))

# Load .env.test so DATABASE_URL points at test_db, exactly like the pytest suite.
from dotenv import load_dotenv  # noqa: E402

load_dotenv(DOGRAH_DIR / "api" / ".env.test")

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from api.db.models import (  # noqa: E402
    APIKeyModel,
    OrganizationModel,
    UserModel,
    organization_users_association,
)
from api.utils.api_key import hash_api_key  # noqa: E402


def raw_key_from_env() -> str:
    key = os.environ.get("DOGRAH_KEY")
    if key:
        return key
    # Fall back to vaani-ai/.env DOGRAH_API_KEY
    env_file = Path(__file__).resolve().parents[2] / "vaani-ai" / ".env"
    for line in env_file.read_text().splitlines():
        if line.startswith("DOGRAH_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("DOGRAH_KEY not provided and not found in vaani-ai/.env")


async def main() -> None:
    raw = raw_key_from_env()
    digest = hash_api_key(raw)
    engine = create_async_engine(os.environ["DATABASE_URL"])
    async with async_sessionmaker(bind=engine)() as session:
        # Ensure an org exists. Reuse the same provider_id scheme as signup:
        # a stable provider id for the QA app.
        provider_id = "qa-vaani-app"
        org = (
            await session.execute(
                select(OrganizationModel).where(OrganizationModel.provider_id == provider_id)
            )
        ).scalars().first()
        if org is None:
            org = OrganizationModel(provider_id=provider_id)
            session.add(org)
            await session.flush()
            print(f"created organization provider_id={provider_id} id={org.id}")
        else:
            print(f"organization exists id={org.id}")

        existing = (
            await session.execute(
                select(APIKeyModel).where(APIKeyModel.key_hash == digest)
            )
        ).scalars().first()
        if existing is not None and existing.created_by:
            print(f"api key already registered (id={existing.id})")
            return
        if existing is not None:
            # Orphan key from an earlier partial bootstrap — remove and re-add.
            await session.delete(existing)
            await session.flush()
            print(f"removed orphan api key id={existing.id}")

        # The key must have a created_by user with the org selected; dograh's
        # API-key auth resolves the user and sets the org context from it.
        user = (
            await session.execute(
                select(UserModel).where(UserModel.provider_id == "qa-vaani-user")
            )
        ).scalars().first()
        if user is None:
            user = UserModel(
                provider_id="qa-vaani-user",
                email="qa-vaani-app@vaani.local",
                selected_organization_id=org.id,
            )
            session.add(user)
            await session.flush()
            await session.execute(
                organization_users_association.insert().values(
                    user_id=user.id, organization_id=org.id
                )
            )
            print(f"created user id={user.id}")
        else:
            print(f"user exists id={user.id}")

        session.add(
            APIKeyModel(
                organization_id=org.id,
                name="qa-vaani-app",
                key_hash=digest,
                key_prefix=raw[:8],
                is_active=True,
                created_by=user.id,
            )
        )
        await session.commit()
        print(f"registered api key for org {org.id}")


if __name__ == "__main__":
    asyncio.run(main())
