import { heatColor, packedToColor3 } from "./color";

const BAR_WIDTH_STUDS = 2.4;
const BAR_HEIGHT_STUDS = 0.32;
const BAR_BACKGROUND = Color3.fromRGB(34, 34, 34);
const BUBBLE_WIDTH_STUDS = 8;
const BUBBLE_HEIGHT_STUDS = 2.4;

/**
 * The floating widgets attached to one creature: a speech bubble fed by the
 * `say` actuator and an energy bar fed by the engine each tick.
 */
export interface CreatureVisuals {
  /**
   * Shows or hides the speech bubble.
   *
   * @param text - Text to display, or undefined to hide the bubble.
   */
  setSpeech(text: string | undefined): void;
  /**
   * Updates the energy bar fill.
   *
   * @param ratio - Energy as a fraction of the maximum, clamped to 0-1.
   */
  setEnergy(ratio: number): void;
  /** Destroys both widgets. */
  destroy(): void;
}

function createEnergyBar(parent: BasePart, offsetStuds: number): { gui: BillboardGui; fill: Frame } {
  const gui = new Instance("BillboardGui");
  gui.Name = "EnergyBar";
  gui.Size = UDim2.fromScale(BAR_WIDTH_STUDS, BAR_HEIGHT_STUDS);
  gui.SizeOffset = new Vector2(0, 0);
  gui.StudsOffsetWorldSpace = new Vector3(0, offsetStuds, 0);
  gui.AlwaysOnTop = true;
  gui.MaxDistance = 250;

  const track = new Instance("Frame");
  track.Size = UDim2.fromScale(1, 1);
  track.BackgroundColor3 = BAR_BACKGROUND;
  track.BackgroundTransparency = 0.25;
  track.BorderSizePixel = 0;
  track.Parent = gui;

  const fill = new Instance("Frame");
  fill.Size = UDim2.fromScale(1, 1);
  fill.BackgroundColor3 = packedToColor3(heatColor(0));
  fill.BorderSizePixel = 0;
  fill.Parent = track;

  gui.Parent = parent;
  return { gui, fill };
}

function createSpeechBubble(parent: BasePart, offsetStuds: number): { gui: BillboardGui; label: TextLabel } {
  const gui = new Instance("BillboardGui");
  gui.Name = "SpeechBubble";
  gui.Size = UDim2.fromScale(BUBBLE_WIDTH_STUDS, BUBBLE_HEIGHT_STUDS);
  gui.StudsOffsetWorldSpace = new Vector3(0, offsetStuds, 0);
  gui.AlwaysOnTop = true;
  gui.MaxDistance = 200;
  gui.Enabled = false;

  const label = new Instance("TextLabel");
  label.Size = UDim2.fromScale(1, 1);
  label.BackgroundColor3 = Color3.fromRGB(255, 255, 255);
  label.BackgroundTransparency = 0.05;
  label.BorderSizePixel = 0;
  label.TextColor3 = Color3.fromRGB(0, 0, 0);
  label.TextScaled = true;
  label.Font = Enum.Font.GothamMedium;
  label.Text = "";
  label.Parent = gui;

  const corner = new Instance("UICorner");
  corner.CornerRadius = new UDim(0.25, 0);
  corner.Parent = label;

  gui.Parent = parent;
  return { gui, label };
}

/**
 * Attaches an energy bar and a speech bubble above a creature part.
 *
 * @param part - The creature part the widgets follow.
 * @param visualRadiusStuds - Radius of the creature, used to clear the widgets
 *   of the body.
 * @returns The widget handle.
 */
export function createCreatureVisuals(part: BasePart, visualRadiusStuds: number): CreatureVisuals {
  const barOffset = visualRadiusStuds + 0.6;
  const bubbleOffset = barOffset + 1.4;
  const bar = createEnergyBar(part, barOffset);
  const bubble = createSpeechBubble(part, bubbleOffset);

  return {
    setSpeech(text: string | undefined): void {
      if (text === undefined) {
        bubble.gui.Enabled = false;
        bubble.label.Text = "";
        return;
      }
      bubble.label.Text = text;
      bubble.gui.Enabled = true;
    },
    setEnergy(ratio: number): void {
      const clamped = math.clamp(ratio, 0, 1);
      bar.fill.Size = UDim2.fromScale(clamped, 1);
      bar.fill.Visible = clamped > 0;
      bar.fill.BackgroundColor3 = packedToColor3(heatColor(1 - clamped));
    },
    destroy(): void {
      bar.gui.Destroy();
      bubble.gui.Destroy();
    },
  };
}
