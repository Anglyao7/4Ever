from pydantic import BaseModel


class PlatformModule(BaseModel):
    id: str
    name: str
    description: str
    category: str
    enabled: bool = True
    locked: bool = False


class ModuleUpdateRequest(BaseModel):
    enabled: bool


class ModuleAdminModule(BaseModel):
    id: str
    name: str
    description: str
    category: str
    enabled: bool
    locked: bool
