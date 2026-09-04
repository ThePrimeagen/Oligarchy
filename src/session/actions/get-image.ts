import { requireSession, runClient, type Session } from "../client.ts";
import { renderImage } from "../image.ts";

export async function getImageRun(session: Session): Promise<void> {
  const id = requireSession(session);
  if (id === undefined) {
    return;
  }
  const result = await runClient(session, ["get-image", "--session-id", id]);
  if (result.code !== 0) {
    console.log(result.stderr);
    return;
  }
  renderImage(result.stdout);
}
