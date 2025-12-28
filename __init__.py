"""CornmeisterNL Powerpack - ComfyUI custom nodes"""

import logging
import folder_paths
import comfy.sd

WEB_DIRECTORY = "./js"

LORA_CFG = "LORA_CFG"
POWERPACK_VERSION = "1.0.3"

_logger = logging.getLogger("CornmeisterNL Powerpack")

def _log_magenta(msg: str):
    magenta = "\033[1;38;5;201m"
    reset = "\033[0m"
    _logger.info(f"{magenta}⚡ [CornmeisterNL Powerpack]{reset} {msg}")

def _loras_list():
    try:
        loras = folder_paths.get_filename_list("loras")
    except Exception:
        loras = []
    return ["(none)"] + list(loras)


class PowerLoraConfigurator:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "lora": (_loras_list(),),
                "trigger": ("STRING", {"default": ""}),
                "strength_model": ("FLOAT", {"default": 1.0, "min": -5.0, "max": 5.0, "step": 0.05}),
                "strength_clip": ("FLOAT", {"default": 1.0, "min": -5.0, "max": 5.0, "step": 0.05}),
            }
        }

    RETURN_TYPES = (LORA_CFG,)
    RETURN_NAMES = ("cfg",)
    FUNCTION = "run"
    CATEGORY = "⚡ CornmeisterNL/PowerPack/LoRA"

    def run(self, lora, trigger, strength_model, strength_clip):
        if lora == "(none)":
            lora = ""
        return ({
            "lora": lora,
            "trigger": (trigger or "").strip(),
            "strength_model": float(strength_model),
            "strength_clip": float(strength_clip),
        },)


class PowerLoraSelector:
    @classmethod
    def INPUT_TYPES(cls):
        # Keep UI clean: only show cfg_1; accept cfg_2..cfg_50 as hidden for validation        # active is STRING; frontend turns it into a combo showing trigger labels
        hidden_cfg = {f"cfg_{i}": (LORA_CFG,) for i in range(2, 51)}
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "active": ("STRING", {"default": "1"}),
            },
            "optional": {
                "cfg_1": (LORA_CFG,),
            },
            "hidden": hidden_cfg,
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("model", "clip", "trigger")
    FUNCTION = "run"
    CATEGORY = "⚡ CornmeisterNL/PowerPack/LoRA"

    def run(self, model, clip, active, **kwargs):
        try:
            s = str(active)
            if ':' in s:
                s = s.split(':', 1)[0]
            idx = int(s.strip())
        except Exception:
            idx = 1
        if idx < 1:
            idx = 1

        cfg = kwargs.get(f"cfg_{idx}", None)

        out_model = model
        out_clip = clip
        trigger = ""

        if isinstance(cfg, dict):
            lora_name = cfg.get("lora", "") or ""
            trigger = (cfg.get("trigger", "") or "").strip()
            strength_model = float(cfg.get("strength_model", 1.0))
            strength_clip = float(cfg.get("strength_clip", 1.0))

            if lora_name:
                lora_path = folder_paths.get_full_path("loras", lora_name)
                lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
                out_model, out_clip = comfy.sd.load_lora_for_models(
                    model, clip, lora, strength_model, strength_clip
                )

        return (out_model, out_clip, trigger)


class PowerTextConcat:
    @classmethod
    def INPUT_TYPES(cls):
        hidden_text = {f"text_{i}": ("STRING", {"forceInput": True}) for i in range(2, 51)}
        return {
            "required": {
                "separator": ("STRING", {"default": ", ", "multiline": False}),
                "strip_parts": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "trigger": ("STRING", {"default": ""}),
                "text_1": ("STRING", {"forceInput": True}),
            },
            "hidden": hidden_text,
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "run"
    CATEGORY = "⚡ CornmeisterNL/PowerPack/Text"

    def run(self, separator, strip_parts, **kwargs):
        parts = []

        # trigger is OPTIONAL → veilig ophalen
        trig = kwargs.get("trigger", "")
        if trig is not None:
            trig = str(trig).strip() if strip_parts else str(trig)
            if trig:
                parts.append(trig)

        # overige text inputs
        for i in range(1, 51):
            key = f"text_{i}"
            if key not in kwargs:
                continue
            val = kwargs.get(key)
            if not val:
                continue
            val = str(val).strip() if strip_parts else str(val)
            if val:
                parts.append(val)

        sep = separator if separator is not None else " "
        return (sep.join(parts),)

import os
import json
import glob
import torch

def _cmnl_round8(v: int) -> int:
    return max(64, int(round(v / 8.0)) * 8)

def _cmnl_load_res_presets():
    '''Load all presets from presets/*.json inside this package.'''
    base = os.path.dirname(__file__)
    pdir = os.path.join(base, "presets")
    presets = {}
    if not os.path.isdir(pdir):
        return presets
    files = sorted(glob.glob(os.path.join(pdir, "*.json")))
    for fp in files:
        try:
            with open(fp, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                for k, v in data.items():
                    if isinstance(k, str) and isinstance(v, (list, tuple)) and len(v) == 2:
                        try:
                            w = int(v[0])
                            h = int(v[1])
                            if w > 0 and h > 0:
                                presets[k] = (w, h)
                        except Exception:
                            continue
        except Exception as e:
            print(f"[CornmeisterNL Powerpack] Failed to load presets from {fp}: {e}")
    return presets

class PowerRes:
    '''
    Power Res
    - Presets loaded from presets/*.json
    - Outputs: LATENT + WIDTH + HEIGHT
    - Manual override supported
    '''

    @classmethod
    def INPUT_TYPES(cls):
        presets = _cmnl_load_res_presets()
        names = list(presets.keys())
        if not names:
            names = ["(no presets found)"]
        return {
            "required": {
                "preset": (names, {"default": names[0]}),
                "manual_override": ("BOOLEAN", {"default": False}),
                "width": ("INT", {"default": 512, "min": 64, "max": 8192, "step": 8}),
                "height": ("INT", {"default": 512, "min": 64, "max": 8192, "step": 8}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 64}),
            }
        }

    RETURN_TYPES = ("LATENT", "INT", "INT")
    RETURN_NAMES = ("LATENT", "WIDTH", "HEIGHT")
    FUNCTION = "make"
    CATEGORY = "⚡ CornmeisterNL/PowerPack/Latent"

    def make(self, preset, manual_override, width, height, batch_size):
        presets = _cmnl_load_res_presets()

        if (not manual_override) and preset in presets:
            w, h = presets[preset]
        else:
            w, h = int(width), int(height)

        w = _cmnl_round8(w)
        h = _cmnl_round8(h)

        latent = torch.zeros([int(batch_size), 4, h // 8, w // 8], device="cpu")
        return ({"samples": latent}, w, h)

import os
import json
import requests

class PowerPromptBuilder:
    """Power Prompt Builder (OpenAI Responses API)

    Inputs:
      - base_prompt (TEXT)
      - instructions (TEXT)

    Output:
      - TEXT (final prompt)
    """

    @classmethod
    def INPUT_TYPES(cls):
        models = [
            "gpt-5.2-chat-latest",
            "gpt-5.2",
            "gpt-5.2-pro",
            "gpt-5.1",
            "gpt-5-mini",
            "gpt-5-nano",
            "custom..."
        ]
        return {
            "required": {
                "base_prompt": ("STRING", {"multiline": True, "default": ""}),
                "instructions": ("STRING", {"multiline": True, "default": ""}),
                "model": (models, {"default": "gpt-5.1"}),
                "custom_model": ("STRING", {"default": ""}),
                "temperature": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0, "step": 0.05}),
                "max_output_tokens": ("INT", {"default": 900, "min": 16, "max": 8192, "step": 16}),
                "force_clean_output": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "api_key_override": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("TEXT",)
    FUNCTION = "run"
    CATEGORY = "⚡ CornmeisterNL/PowerPack/Text"

    def _get_api_key(self, api_key_override: str):
        key = (api_key_override or "").strip()
        if key:
            return key
        return (os.environ.get("OPENAI_API_KEY") or "").strip()

    def _extract_text(self, data):
        if isinstance(data, dict):
            ot = data.get("output_text")
            if isinstance(ot, str) and ot.strip():
                return ot.strip()

            out = data.get("output")
            if isinstance(out, list):
                chunks = []
                for item in out:
                    if not isinstance(item, dict):
                        continue
                    content = item.get("content")
                    if isinstance(content, list):
                        for c in content:
                            if isinstance(c, dict) and c.get("type") in ("output_text", "text"):
                                t = c.get("text")
                                if isinstance(t, str) and t.strip():
                                    chunks.append(t)
                    t2 = item.get("text")
                    if isinstance(t2, str) and t2.strip():
                        chunks.append(t2)
                if chunks:
                    return "\n".join(chunks).strip()
        return ""

    def run(self, base_prompt, instructions, model, custom_model, temperature, max_output_tokens, force_clean_output, api_key_override=""):
        api_key = self._get_api_key(api_key_override)
        if not api_key:
            raise RuntimeError("Missing OpenAI API key. Set OPENAI_API_KEY env var or provide api_key_override.")

        chosen_model = custom_model.strip() if model == "custom..." else model

        sys_text = instructions or ""
        user_text = base_prompt or ""

        if force_clean_output:
            sys_text = (sys_text.strip() + "\n\n" if sys_text.strip() else "") +                        "Return ONLY the final image prompt text. No explanations, no bullet points, no markdown, no code fences."

        payload = {
            "model": chosen_model,
            "input": [
                {"role": "system", "content": [{"type": "input_text", "text": sys_text}]},
                {"role": "user", "content": [{"type": "input_text", "text": user_text}]},

            ],
            "temperature": float(temperature),
            "max_output_tokens": int(max_output_tokens),
        }

        url = "https://api.openai.com/v1/responses"
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

        resp = requests.post(url, headers=headers, json=payload, timeout=(10, 120))
        if resp.status_code >= 400:
            try:
                err = resp.json()
            except Exception:
                err = {"error": resp.text}
            raise RuntimeError(f"OpenAI API error ({resp.status_code}): {err}")

        data = resp.json()
        text = self._extract_text(data)
        if not text:
            raise RuntimeError("OpenAI returned an empty response text. Try increasing max_output_tokens or switching model.")
        return (text,)

import os
from PIL import Image, PngImagePlugin
import numpy as np
import datetime

class PowerSaveImage:
    OUTPUT_NODE = True  # belangrijk: dit is een output node

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),

                "share_output_path": ("STRING", {"default": "output/share"}),
                "full_output_path": ("STRING", {"default": "output/full"}),

                "save_share_image": ("BOOLEAN", {"default": True}),
                "save_full_flow": ("BOOLEAN", {"default": False}),

                "filename_prefix": ("STRING", {"default": "power"}),
                "format": (["PNG", "JPEG"], {"default": "PNG"}),
            },
            "optional": {
                "positive_prompt": ("STRING", {"multiline": True, "default": ""}),
                "negative_prompt": ("STRING", {"multiline": True, "default": ""}),
                "model_name": ("STRING", {"default": ""}),
                "seed": ("INT", {"default": 0}),
                "steps": ("INT", {"default": 0}),
                "cfg": ("FLOAT", {"default": 0.0}),
                "sampler": ("STRING", {"default": ""}),
                "scheduler": ("STRING", {"default": ""}),
                "width": ("INT", {"default": 0}),
                "height": ("INT", {"default": 0}),
                "jpeg_quality": ("INT", {"default": 95, "min": 70, "max": 100}),
            },
            # ✅ hidden inputs: ComfyUI geeft deze automatisch mee (geen UI veld!)
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "save"
    CATEGORY = "⚡ CornmeisterNL/PowerPack/Save"

    def _expand_time_tokens(self, text: str) -> str:
        """
        Replace [time(%Y-%m-%d)] style tokens
        """
        import re, datetime

        def repl(m):
            try:
                return datetime.datetime.now().strftime(m.group(1))
            except Exception:
                return m.group(0)

        return re.sub(r"\[time\((.*?)\)\]", repl, text or "")

    def _resolve_path(self, path_str: str) -> str:
        """
        Manager-safe path resolver:
        - always inside ComfyUI output dir
        - expands [time(...)]
        - blocks path traversal
        """
        import os
    
        base_output = folder_paths.get_output_directory()
    
        sub = self._expand_time_tokens((path_str or "").strip()).replace("\\", "/")
        if not sub:
            return base_output
    
        # prevent absolute paths & traversal
        while sub.startswith("/"):
            sub = sub[1:]
        if ".." in sub:
            raise ValueError("Invalid output path")
    
        full_path = os.path.normpath(os.path.join(base_output, sub))
    
        if not full_path.startswith(os.path.abspath(base_output)):
            raise ValueError("Invalid output path")
    
        os.makedirs(full_path, exist_ok=True)
        return full_path

    

    def save(
        self,
        image,
        share_output_path,
        full_output_path,
        save_share_image,
        save_full_flow,
        filename_prefix,
        format,
        positive_prompt="",
        negative_prompt="",
        model_name="",
        seed=0,
        steps=0,
        cfg=0.0,
        sampler="",
        scheduler="",
        width=0,
        height=0,
        jpeg_quality=95,
        prompt=None,
        extra_pnginfo=None,
    ):
        import os, json, datetime
        import numpy as np
        from PIL import Image, PngImagePlugin

        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        filename_base = f"{filename_prefix}_{ts}"

        # IMAGE tensor → PIL
        img = image[0].cpu().numpy()
        img = np.clip(img * 255.0, 0, 255).astype(np.uint8)
        pil_img = Image.fromarray(img)

        # CivitAI/A1111-style parameters string (key: parameters)
        parameters = (
            f"{positive_prompt}\n"
            f"Negative prompt: {negative_prompt}\n"
            f"Steps: {steps}, Sampler: {sampler}, Schedule type: {scheduler}, "
            f"CFG scale: {cfg}, Seed: {seed}, Size: {width}x{height}, "
            f"Model: {model_name}"
        )

        # -----------------------------
        # 1) SHARE IMAGE
        # -----------------------------
        if bool(save_share_image):
            share_dir = self._resolve_path(share_output_path)
            if format == "PNG":
                pnginfo = PngImagePlugin.PngInfo()
                pnginfo.add_text("parameters", parameters)
                share_path = os.path.join(share_dir, f"{filename_base}.png")
                pil_img.save(share_path, pnginfo=pnginfo)
            else:
                exif = pil_img.getexif()
                exif[0x9286] = parameters  # UserComment
                share_path = os.path.join(share_dir, f"{filename_base}.jpg")
                pil_img.save(share_path, "JPEG", quality=int(jpeg_quality), exif=exif)

            print(f"[⚡ PowerSaveImage] Share image saved: {share_path}")

        # -----------------------------
        # 2) FULL FLOW (PNG + TXT)
        # -----------------------------
        if bool(save_full_flow):
            full_dir = self._resolve_path(full_output_path)

            # extra_pnginfo bevat meestal {"workflow": {...}} (kan ook leeg zijn)
            workflow = None
            if isinstance(extra_pnginfo, dict):
                workflow = extra_pnginfo.get("workflow", None)

            # prompt is de “prompt graph” dict van ComfyUI
            prompt_obj = prompt if isinstance(prompt, (dict, list)) else None

            # PNG met embedded prompt/workflow (ComfyUI-stijl)
            pnginfo_full = PngImagePlugin.PngInfo()

            # embed altijd parameters ook (handig)
            pnginfo_full.add_text("parameters", parameters)

            if prompt_obj is not None:
                pnginfo_full.add_text("prompt", json.dumps(prompt_obj))
            if workflow is not None:
                pnginfo_full.add_text("workflow", json.dumps(workflow))

            full_png_path = os.path.join(full_dir, f"{filename_base}_full.png")
            pil_img.save(full_png_path, pnginfo=pnginfo_full)

            # TXT dump (prompt + workflow + extra)
            txt_path = os.path.join(full_dir, f"{filename_base}_workflow.txt")
            dump = {
                "parameters": parameters,
                "prompt": prompt_obj,
                "workflow": workflow,
                "extra_pnginfo": extra_pnginfo if isinstance(extra_pnginfo, dict) else None,
            }
            with open(txt_path, "w", encoding="utf-8") as f:
                json.dump(dump, f, indent=2)

            print(f"[⚡ PowerSaveImage] Full flow saved:")
            print(f"  PNG: {full_png_path}")
            print(f"  TXT: {txt_path}")

        # SUPER belangrijk: nooit None returnen bij output node
        return {}



class PowerDiffusionModelLoader:
    @classmethod
    def INPUT_TYPES(cls):
        import folder_paths
        try:
            models = folder_paths.get_filename_list("unet")
        except Exception:
            models = []
        if not models:
            models = ["(no models found)"]

        return {
            "required": {
                "model_name": (models, {"default": models[0]}),
            }
        }

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("model", "model_name")
    FUNCTION = "load"
    CATEGORY = "⚡ CornmeisterNL/PowerPack/Loaders"

    def load(self, model_name):
        import folder_paths
        import comfy.sd

        if model_name == "(no models found)":
            raise RuntimeError("No diffusion models found in models/unet")

        model_path = folder_paths.get_full_path("unet", model_name)
        if not model_path:
            raise RuntimeError(f"Model not found: {model_name}")

        model = comfy.sd.load_diffusion_model(model_path)
        return (model, model_name)
        

NODE_CLASS_MAPPINGS = {
    "CornmeisterNL_PowerPromptBuilder": PowerPromptBuilder,
    "CornmeisterNL_PowerRes": PowerRes,
    "CornmeisterNL_PowerLoraConfigurator": PowerLoraConfigurator,
    "CornmeisterNL_PowerLoraSelector": PowerLoraSelector,
    "CornmeisterNL_PowerTextConcat": PowerTextConcat,
    "CornmeisterNL_PowerSaveImage": PowerSaveImage,
    "CornmeisterNL_PowerDiffusionModelLoader": PowerDiffusionModelLoader,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CornmeisterNL_PowerPromptBuilder": "Power Prompt Builder",
    "CornmeisterNL_PowerRes": "Power Res",
    "CornmeisterNL_PowerLoraConfigurator": "Power LoRA Configurator",
    "CornmeisterNL_PowerLoraSelector": "Power LoRA Selector",
    "CornmeisterNL_PowerTextConcat": "Power Text Concat",
    "CornmeisterNL_PowerSaveImage": "Power Save Image",
    "CornmeisterNL_PowerDiffusionModelLoader": "Power Diffusion Model Loader"
}

_log_magenta(f"Backend loaded (v{POWERPACK_VERSION})")