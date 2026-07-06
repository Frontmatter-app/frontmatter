import modal
import os
import asyncio

if modal.is_local():
    Request = None
    HTTPException = None
    StreamingResponse = None
else:
    from fastapi import Request, HTTPException
    from fastapi.responses import StreamingResponse
    import boto3

from firebase import verify_id_token

_r2_client = None

async def _s3_call(fn, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))


def get_r2_client():
    global _r2_client
    if _r2_client is None:
        _r2_client = boto3.client(
            's3',
            endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
            aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
            region_name='auto',
        )
    return _r2_client


async def verify_auth(request: Request):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
    return await verify_id_token(auth_header.split("Bearer ")[1])


def setup_r2_routes(app):
    @app.put("/r2/upload/{key:path}")
    async def r2_upload(key: str, request: Request):
        await verify_auth(request)
        body = await request.body()
        client = get_r2_client()
        bucket = os.environ['R2_BUCKET_NAME']
        await _s3_call(client.put_object, Bucket=bucket, Key=key, Body=body)
        return {"status": "ok"}

    @app.get("/r2/download/{key:path}")
    async def r2_download(key: str, request: Request):
        await verify_auth(request)
        client = get_r2_client()
        bucket = os.environ['R2_BUCKET_NAME']
        try:
            obj = await _s3_call(client.get_object, Bucket=bucket, Key=key)
            return StreamingResponse(obj['Body'], media_type=obj.get('ContentType', 'application/octet-stream'))
        except client.exceptions.NoSuchKey:
            raise HTTPException(status_code=404, detail="Key not found.")

    @app.delete("/r2/{key:path}")
    async def r2_delete(key: str, request: Request):
        await verify_auth(request)
        client = get_r2_client()
        bucket = os.environ['R2_BUCKET_NAME']
        await _s3_call(client.delete_object, Bucket=bucket, Key=key)
        return {"status": "deleted"}

    @app.get("/r2/public/{key:path}")
    async def r2_public_url(key: str, request: Request):
        await verify_auth(request)
        account_id = os.environ.get('R2_ACCOUNT_ID', '')
        bucket = os.environ.get('R2_BUCKET_NAME', '')
        return {"url": f"https://{bucket}.{account_id}.r2.cloudflarestorage.com/{key}"}
