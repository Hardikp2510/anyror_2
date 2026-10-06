import io
from pathlib import Path
import torch
import torch.nn as nn
from PIL import Image
from torchvision import transforms
from app.core.config import settings
from app.core.exceptions import CaptchaSolveError
from app.core.logging import logger

class CaptchaCNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.cnn = nn.Sequential(
            nn.Conv2d(1, 32, kernel_size=3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(32, 64, kernel_size=3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(64, 128, kernel_size=3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
        )
        self.pool = nn.AdaptiveAvgPool2d((5, 15))
        self.flatten = nn.Flatten()
        self.fc = nn.Sequential(nn.Linear(128 * 5 * 15, 512), nn.ReLU(), nn.Dropout(0.2))
        
        self.head1 = nn.Linear(512, 10)
        self.head2 = nn.Linear(512, 10)
        self.head3 = nn.Linear(512, 10)
        self.head4 = nn.Linear(512, 10)
        self.head5 = nn.Linear(512, 10)
        self.head6 = nn.Linear(512, 10)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, ...]:
        x = self.cnn(x)
        x = self.pool(x)
        x = self.flatten(x)
        x = self.fc(x)
        return self.head1(x), self.head2(x), self.head3(x), self.head4(x), self.head5(x), self.head6(x)

class CaptchaSolver:
    def __init__(self):
        self.device = torch.device("cpu")
        self.model = CaptchaCNN()
        self._is_loaded = False
        self._transform = transforms.Compose([
            transforms.Grayscale(),
            transforms.Resize((40, 120)),
            transforms.ToTensor(),
        ])

    def load_weights(self) -> None:
        if self._is_loaded:
            return
            
        candidates = [
            settings.CAPTCHA_MODEL_PATH,
            Path("captcha/captcha_model_v1.pth"),
            Path("backend/captcha/captcha_model_v1.pth"),
            Path("captcha_model_v1.pth"),
            Path("backend/captcha_model_v1.pth")
        ]
        model_path = next((p for p in candidates if p.exists()), None)
        if not model_path:
            logger.error("CAPTCHA model weights file missing!", tried=[str(p) for p in candidates])
            raise CaptchaSolveError(f"Model file not found in any expected location: {[str(p) for p in candidates]}")

        try:
            self.model.load_state_dict(torch.load(model_path, map_location=self.device, weights_only=True))
            self.model.eval()
            self._is_loaded = True
            logger.info("PyTorch CAPTCHA AI Loaded Successfully.", path=str(model_path))
        except Exception as e:
            logger.error("Failed to load CAPTCHA model weights", error=str(e), path=str(model_path))
            raise CaptchaSolveError(f"Failed loading weights from {model_path}: {e}") from e

    async def solve(self, image_bytes: bytes) -> str:
        if not self._is_loaded:
            self.load_weights()

        try:
            image = Image.open(io.BytesIO(image_bytes))
            tensor_img = self._transform(image).unsqueeze(0).to(self.device)
            
            with torch.no_grad():
                heads = self.model(tensor_img)
                predictions = [str(torch.argmax(head).item()) for head in heads]
                captcha_str = "".join(predictions)
                logger.info("CAPTCHA Predicted", prediction=captcha_str)
                return captcha_str
        except Exception as e:
            logger.error("CAPTCHA solving execution failed", error=str(e))
            raise CaptchaSolveError("Failed to run CAPTCHA inference") from e

captcha_solver = CaptchaSolver()