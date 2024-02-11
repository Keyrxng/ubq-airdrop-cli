import Command from "../commands/help";

describe("Command", () => {
  it("should display the legend for the repository names", async () => {
    const command = new Command();
    const spy = jest.spyOn(console, "log").mockImplementation();
    await command.execute();

    expect(spy).toHaveBeenCalledWith("Key\tRepository");
    expect(spy).toHaveBeenCalledWith("===\t==========");
    expect(spy).toHaveBeenCalledWith(
      "common\tuad-common-contracts-prototyping"
    );
    expect(spy).toHaveBeenCalledWith("uad-de\tuad-debt-contracts-prototyping");
    expect(spy).toHaveBeenCalledWith(
      "uad-bo\tuad-bonding-contracts-prototyping"
    );
    expect(spy).toHaveBeenCalledWith("contra\tuad-contracts");

    spy.mockRestore();
  });
});
