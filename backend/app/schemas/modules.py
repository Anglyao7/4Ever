from pydantic import BaseModel


class PlatformModule(BaseModel):
    id: str
    name: str
    description: str
    category: str
