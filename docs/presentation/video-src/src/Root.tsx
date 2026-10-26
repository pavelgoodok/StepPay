import { Composition } from "remotion";
import { StepPayVideo, TOTAL_FRAMES } from "./Composition";
import { DEMO_FRAMES, StepPayDemo } from "./Demo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
    <Composition
      id="Demo"
      component={StepPayDemo}
      durationInFrames={DEMO_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="StepPay"
      component={StepPayVideo}
      durationInFrames={TOTAL_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
    </>
  );
};
