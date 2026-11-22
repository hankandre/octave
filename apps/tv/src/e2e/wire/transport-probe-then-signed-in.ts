// Wire test transport-probe-then-signed-in (T3-05 items 1, 3 and 7): the gateway's probe, sign-in, one signed-in call
// and logout, through the app's transport and the one OkHttp client. The host judges the capture: the probe and the
// sign-in carry the header with an empty token, /UserViews and the logout carry the token, and no URL holds it.
import { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import { codeOf, UNREACHABLE, type WireContext, type WireOutcome } from "./wire-context";

export async function run({ base, list, crypto, transport, seam }: WireContext): Promise<WireOutcome> {
  const gateway = new JellyfinGateway(base, crypto, transport);
  try {
    seam.add(await gateway.connect());
  } catch (error) {
    seam.add(error);
    return codeOf(error) === "network" ? UNREACHABLE : { words: `outcome=connect-${codeOf(error)}` };
  }
  try {
    gateway.confirmUnencryptedConnection();
    seam.add(await gateway.login(list.user, list.password));
    const views = await gateway.userViews();
    seam.add(views);
    await gateway.logout();
    return { words: `outcome=ok views=${views.length}` };
  } catch (error) {
    seam.add(error);
    return { words: `outcome=${codeOf(error)}` };
  }
}
