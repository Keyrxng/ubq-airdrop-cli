import { writeFile } from "fs/promises";
import { fetchPublicRepositories } from "../invoke";
import {
  CSVData,
  Contributor,
  NoPayments,
  PaymentInfo,
  Repositories,
} from "../types";

// Generates a unique key set for the repositories
export async function genKeySet() {
  const publicRepos = await fetchPublicRepositories("Ubiquity");

  const keySet = publicRepos.map((repo) => {
    return {
      key: repo.name.slice(0, 6),
      name: repo.name,
      repo,
    };
  });

  const mutateDupes = keySet.map((set) => {
    if (keySet.filter((k) => k.key === set.key).length > 1) {
      const split =
        set.name.split("-")[1]?.slice(0, 6) ?? set.name?.slice(2, 8);
      return {
        key: split,
        name: set.name,
        repo: set.repo as Repositories,
      };
    }
    return set;
  });

  return mutateDupes;
}

// Removes duplicate payments
export function removeDuplicates(arr: any[]) {
  return arr.filter(
    (v, i, a) => a.findIndex((t) => t.issueNumber === v.issueNumber) === i
  );
}

// Removes duplicate contributors and sums their balances
export function removeDuplicatesContributors(cont: Contributor) {
  return Object.keys(cont).reduce((acc, curr) => {
    if (acc[curr]) {
      acc[curr] += cont[curr];
    } else {
      acc[curr] = cont[curr];
    }
    return acc;
  }, {} as Contributor);
}

// Loading bar for the CLI
export async function loadingBar() {
  const frames = ["| ", "/ ", "- ", "\\ "];
  let i = 0;
  return setInterval(() => {
    process.stdout.write("\r" + frames[i++]);
    i &= 3;
  }, 100);
}

// Converts arrays and objects to CSV strings
export async function dataToCSV(
  json: PaymentInfo[] | NoPayments[] | Contributor
) {
  console.log("Converting JSON to CSV...");
  if (!json || json.length === 0) {
    return "";
  }
  let csv = "";

  try {
    if (Array.isArray(json)) {
      removeDuplicates(json);
      csv = json
        .sort((a: { repoName: string }, b: { repoName: string }) =>
          a.repoName.localeCompare(b.repoName)
        )
        .map((row) => Object.values(row).join(","))
        .join("\n");
    } else {
      removeDuplicatesContributors(json);
      csv = Object.entries(json)
        .sort((a, b) => b[1] - a[1])
        .map((row) => row.join(","))
        .join("\n");
    }
  } catch (err) {
    console.log(err);
  }

  return csv;
}

// Outputs the results from `tally` and `tally-from` to three CSV files
export async function writeCSV(data: CSVData) {
  console.log("Writing CSVs...");
  const groups = [
    {
      name: "Contributors",
      headers: ["Username", "Balance"],
      data: data.contributors,
    },
    {
      name: "All Payments",
      headers: [
        "Repository",
        "Issue #",
        "Amount",
        "Currency",
        "Payee",
        "Type",
        "URL",
      ],
      data: [...data.allPayments, ...data.allNoAssigneePayments],
    },
    {
      name: "No Payments",
      headers: ["Repository", "Archived", "Last Commit", "Message", "URL"],
      data: data.noPayments,
    },
  ];

  for (const group of groups) {
    console.log(`Writing ${group.name}...`);
    let csv = "";
    csv += `${group.headers.join(",")}\n`;
    csv += await dataToCSV(group.data);

    await writeToFile(
      `${process.cwd()}/${group.name.toLowerCase().replace(" ", "_")}.csv`,
      csv
    );
  }
}

// Outputs the CSVs to the root of the project
export async function writeToFile(fileName: string, data: string) {
  try {
    await writeFile(fileName, data);
  } catch (err) {
    console.error(err);
  }
}

// Outputs the results from `single` to four CSV files
export async function writeCsvs(
  repo: Repositories,
  contributors: Contributor,
  allPayments: PaymentInfo[],
  allNoAssigneePayments: PaymentInfo[],
  noPayments: NoPayments[]
) {
  try {
    if (Object.keys(contributors).length === 0) {
      console.log("No payments found for this repo.");
    } else {
      const csvObjects = Object.entries(contributors);

      const csv: Contributor = {};
      for (const [key, value] of csvObjects) {
        csv[key] = value;
      }
      const rawBalanceCsv = await dataToCSV(csv);

      await writeToFile(`${repo.name}-raw-balances.csv`, rawBalanceCsv);
    }
  } catch (err) {
    console.log(err);
  }

  try {
    if (allPayments.length === 0) {
      console.log("No payments found for this repo.");
    } else {
      const allPaymentsCsv = await dataToCSV(
        allPayments.sort((a: { repoName: string }, b: { repoName: any }) =>
          a.repoName.localeCompare(b.repoName)
        )
      );

      await writeToFile(`${repo.name}-all-payments.csv`, allPaymentsCsv);
    }
  } catch (err) {
    console.log(err);
  }

  try {
    if (allNoAssigneePayments.length === 0) {
      console.log("No manual checks needed.");
    } else {
      const noAssigneeCsv = await dataToCSV(
        allNoAssigneePayments.sort(
          (a: { repoName: string }, b: { repoName: any }) =>
            a.repoName.localeCompare(b.repoName)
        )
      );

      await writeToFile(
        `${repo.name}-manual-checks-required.csv`,
        noAssigneeCsv
      );
    }
  } catch (err) {
    console.log(err);
  }

  try {
    if (noPayments.length === 0) {
      console.log("All payments found are assigned.");
    } else {
      const noPaymentsCsv = await dataToCSV(
        noPayments.sort(
          (a: { lastCommitDate: any }, b: { lastCommitDate: string }) =>
            b.lastCommitDate.localeCompare(a.lastCommitDate)
        )
      );
      await writeToFile(`${repo.name}-no-payments.csv`, noPaymentsCsv);
    }
  } catch (err) {
    console.log(err);
  }
}
