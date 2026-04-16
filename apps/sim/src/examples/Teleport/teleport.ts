import { type ActorRef, Actuator, type Context, choice, optional, param, type Vector2 } from "mindcraft";

export default Actuator({
  name: "teleport",
  icon: "./teleport.svg",
  docs: "./teleport.md",
  args: [
    optional(
      choice(
        param("destPos", { type: "Vector2", anonymous: true }),
        param("destActor", { type: "ActorRef", anonymous: true })
      )
    ),
  ],
  onExecute(ctx: Context, args: { destPos?: Vector2; destActor?: ActorRef }): void {
    if (args.destPos) {
      ctx.self.position = args.destPos;
    } else if (args.destActor) {
      ctx.self.position = args.destActor.position;
    } else {
      const targetPos = ctx.brain.getTargetPosition();
      if (targetPos) {
        ctx.self.position = targetPos;
      }
    }
  },
});
