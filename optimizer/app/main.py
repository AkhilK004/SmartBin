from fastapi import FastAPI

app = FastAPI(title="SmartBin optimizer")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
