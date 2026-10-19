import {
  Dithering,
  type PaperShaderElement,
} from "@paper-design/shaders-react";
import { useCallback, useEffect, useRef } from "react";

type SignInAtmosphereProps = {
  motionEnabled: boolean;
  storm: number;
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function SignInAtmosphere({ motionEnabled, storm }: SignInAtmosphereProps) {
  const shaderRef = useRef<PaperShaderElement>(null);
  const stormRef = useRef(clamp01(storm));

  const update = useCallback(
    (nextStorm: number) => {
      const normalizedStorm = clamp01(nextStorm);
      stormRef.current = normalizedStorm;

      const shader = shaderRef.current?.paperShaderMount;
      if (!shader) {
        return;
      }

      shader.setSpeed(motionEnabled ? 0.07 + normalizedStorm * 0.31 : 0);
      shader.setUniforms({
        u_pxSize: 6 - normalizedStorm * 2.4,
        u_offsetX: 0,
        u_scale: 0.72 - normalizedStorm * 0.08,
      });
    },
    [motionEnabled],
  );

  useEffect(() => {
    const element = shaderRef.current;
    if (!element) {
      return;
    }

    const stage = element.closest<HTMLElement>(".sign-in-storm");
    let canvas: HTMLCanvasElement | null = null;

    const hideRenderer = () => {
      element.dataset.renderer = "pending";
      stage?.removeAttribute("data-weather-renderer");
    };

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      hideRenderer();
    };

    const markReady = () => {
      const nextCanvas = element.querySelector<HTMLCanvasElement>("canvas");
      const shader = element.paperShaderMount;
      if (!shader || !nextCanvas) {
        return false;
      }

      bindCanvas(nextCanvas);
      element.dataset.renderer = "webgl";
      stage?.setAttribute("data-weather-renderer", "paper-webgl");
      update(stormRef.current);
      return true;
    };

    const handleContextRestored = () => {
      markReady();
    };

    const bindCanvas = (nextCanvas: HTMLCanvasElement) => {
      if (canvas === nextCanvas) {
        return;
      }
      canvas?.removeEventListener("webglcontextlost", handleContextLost);
      canvas?.removeEventListener("webglcontextrestored", handleContextRestored);
      canvas = nextCanvas;
      canvas.addEventListener("webglcontextlost", handleContextLost);
      canvas.addEventListener("webglcontextrestored", handleContextRestored);
    };

    if (markReady()) {
      return () => {
        canvas?.removeEventListener("webglcontextlost", handleContextLost);
        canvas?.removeEventListener("webglcontextrestored", handleContextRestored);
        hideRenderer();
      };
    }

    const observer = new MutationObserver(() => {
      if (markReady()) {
        observer.disconnect();
      }
    });

    observer.observe(element, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      canvas?.removeEventListener("webglcontextlost", handleContextLost);
      canvas?.removeEventListener("webglcontextrestored", handleContextRestored);
      hideRenderer();
    };
  }, [update]);

  useEffect(() => {
    update(storm);
  }, [storm, update]);

  return (
    <Dithering
      ref={shaderRef}
      className="sign-in-storm__shader"
      data-renderer="pending"
      colorBack="#d8cbb8"
      colorFront="#305873"
      shape="warp"
      type="8x8"
      size={6}
      speed={motionEnabled ? 0.07 : 0}
      frame={1260}
      scale={0.72}
      rotation={4}
      offsetY={-0.12}
      width="100%"
      height="100%"
      minPixelRatio={1}
      maxPixelCount={1_200_000}
      aria-hidden="true"
    />
  );
}
