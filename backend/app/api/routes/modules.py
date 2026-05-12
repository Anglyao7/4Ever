from fastapi import APIRouter

from app.schemas.modules import PlatformModule


router = APIRouter(prefix="/modules", tags=["modules"])


MODULES = [
    PlatformModule(
        id="dashboard",
        name="见微知著",
        description="查看平台模块、接口状态和后续扩展入口。",
        category="system",
    ),
    PlatformModule(
        id="chat",
        name="交耳",
        description="兼容 OpenAI、Anthropic、Gemini 格式的对话模块。",
        category="ai",
    ),
    PlatformModule(
        id="image-generation",
        name="虚实",
        description="文本生图、多模型聚合和生成记录能力。",
        category="ai",
    ),
    PlatformModule(
        id="provider-hub",
        name="聚合",
        description="统一管理模型供应商、密钥和默认模型。",
        category="integration",
    ),
    PlatformModule(
        id="workflow",
        name="秩序",
        description="自动化流程、任务节点和触发器。",
        category="automation",
    ),
    PlatformModule(
        id="admin",
        name="自我",
        description="用户、权限、审计和系统配置能力。",
        category="system",
    ),
]


@router.get("", response_model=list[PlatformModule])
async def list_modules() -> list[PlatformModule]:
    return MODULES
