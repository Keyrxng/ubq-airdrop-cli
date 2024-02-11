import { Command, command, metadata, param } from "clime";
import { invoke } from "../invoke";

@command({
  brief: "Tally UBQ airdrop from xxxx-xx-xx.",
  description:
    "Includes all repositories with payments on dev branch since xxxx-xx-xx.",
})
export default class extends Command {
  @metadata
  async execute(
    @param({
      description: "YYYY-MM-DD date to tally from.",
      required: true,
    })
    timeFrom?: string
  ) {
    await invoke(timeFrom ? new Date(timeFrom).toISOString() : undefined);
  }
}
