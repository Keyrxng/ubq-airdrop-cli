import * as dotenv from "dotenv";
import { request, gql } from "graphql-request";
import { writeFile } from "fs/promises";
import { removeDuplicates, removeDuplicatesContributors } from "../utils";

dotenv.config();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_GRAPHQL_API = "https://api.github.com/graphql";

export interface PaymentInfo {
  issueNumber: number;
  repoName: string;
  paymentAmount: number;
  currency: string;
  payee?: string;
  type?: string;
  url: string;
}

export interface Repositories {
  name: string;
  isArchived: boolean;
  lastCommitDate: string;
}

export interface Contributor {
  [username: string]: number;
}

interface NoPayments {
  repoName: string;
  archived: boolean;
  lastCommitDate: string;
  message: string;
  url: string;
}

interface CSVData {
  contributors: Contributor;
  allPayments: PaymentInfo[];
  allNoAssigneePayments: PaymentInfo[];
  noPayments: NoPayments[];
}

export async function fetchPublicRepositories(
  org: string = "Ubiquity",
  repo?: string
): Promise<Repositories[]> {
  let hasNextPage = true;
  let cursor = null;
  const repositories: Repositories[] = [];

  const query = gql`
    query ($org: String!, $cursor: String) {
      organization(login: $org) {
        repositories(first: 100, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              name
              isArchived
              defaultBranchRef {
                target {
                  ... on Commit {
                    history(first: 1) {
                      edges {
                        node {
                          committedDate
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  while (hasNextPage) {
    const response: any = await request(
      GITHUB_GRAPHQL_API,
      query,
      { org, cursor },
      { Authorization: `Bearer ${GITHUB_TOKEN}` }
    );

    const repos = response.organization.repositories.edges;

    for (const repo of repos) {
      const repoInfo = repo.node;
      const lastCommitDate =
        repoInfo.defaultBranchRef?.target?.history.edges.length > 0
          ? repoInfo.defaultBranchRef.target.history.edges[0].node.committedDate
          : null;

      repositories.push({
        name: repoInfo.name,
        isArchived: repoInfo.isArchived,
        lastCommitDate: lastCommitDate,
      });
    }

    const pageInfo = response.organization.repositories.pageInfo;
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  if (repo) {
    return repositories.filter((r) => r.name === repo);
  }

  return repositories;
}

export async function fetchPaymentsForRepository(
  org: string,
  repoName: string,
  since: string
): Promise<{ payments: PaymentInfo[]; noAssigneePayments: PaymentInfo[] }> {
  let hasNextPage = true;
  let cursor = null;
  const payments = new Set<PaymentInfo>();
  const noAssigneePayments = new Set<PaymentInfo>();

  const query = gql`
    query (
      $org: String!
      $repoName: String!
      $cursor: String
      $since: DateTime
    ) {
      repository(owner: $org, name: $repoName) {
        issues(
          first: 100
          after: $cursor
          filterBy: { since: $since, states: [CLOSED, OPEN] }
        ) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              number
              author {
                login
              }
              assignees(first: 1) {
                edges {
                  node {
                    login
                  }
                }
              }
              comments(first: 100) {
                edges {
                  node {
                    body
                    author {
                      login
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  while (hasNextPage) {
    const response: any = await request(
      GITHUB_GRAPHQL_API,
      query,
      { org, repoName, cursor, since },
      { Authorization: `Bearer ${GITHUB_TOKEN}` }
    );

    for (const issue of response.repository.issues.edges) {
      const issueNumber = issue.node.number;
      const issueCreator = issue.node.author?.login;

      const issueAssignee =
        issue.node.assignees.edges.length > 0
          ? issue.node.assignees.edges[0].node?.login
          : "No assignee";

      for (const comment of issue.node.comments.edges) {
        const body = comment.node.body;

        // Match: [ CLAIM 12.5 DAI ] typically the assignee's award
        const match = body.match(
          /.*\[ CLAIM (\d+(\.\d+)?) (XDAI|DAI|WXDAI) \]/
        );

        // Match: [ **[ 12.5 DAI ]] typically the newer <details> type awards
        const altMatch = body.match(
          /.*\[ \[ \*?(\d+(\.\d+)?) \*?(XDAI|DAI|WXDAI)\*? \]\]/
        );

        /**
         * Most of the time the awards are in the format:
         * Assignee >>: ### [ **[ CLAIM 25 WXDAI ],25,,WXDAI
         * Convo|Creator >>: ### [ **gitcoindev: [ CLAIM 18.6 WXDAI ],18.6,.6,WXDAI
         * Assignee >>: ### [ **[ CLAIM 25 WXDAI ],25,,WXDAI
         * Convo|Creator >>: ### [ **rndquu: [ CLAIM 23.4 WXDAI ],23.4,.4,WXDAI
         */

        if (match) {
          const rematch = body.match(/CLAIM (\d+(\.\d+)?) (XDAI|DAI|WXDAI)/);
          const creator = body.includes("Task Creator Reward") ? true : false;
          const conversation = body.includes("Conversation Reward")
            ? true
            : false;

          const type = creator
            ? "creator"
            : conversation
            ? "conversation"
            : "assignee";

          if (
            body.includes(`: [ CLAIM`) &&
            comment.node.author?.login === "ubiquibot"
          ) {
            // this should be either the creator's or conversation awards
            let user = body.split(":")[0];

            if (user.includes("**")) {
              user = user.split("**")[1];
            } else if (user.includes("###")) {
              user = user.split("###")[1];
            } else {
              console.log(`user: ${user}`);
              console.log(`issueNumber: ${issueNumber}`);
              console.log(`body: ${body}`);
            }

            payments.add({
              repoName,
              issueNumber,
              paymentAmount: parseFloat(rematch[1]),
              currency: rematch[3],
              payee: user,
              type,
              url: `https://github.com/${org}/${repoName}/issues/${issueNumber}`,
            });

            if (user === "No assignee") {
              noAssigneePayments.add({
                issueNumber,
                repoName,
                paymentAmount: parseFloat(rematch[1]),
                currency: rematch[3],
                payee: user,
                type,
                url: `https://github.com/${org}/${repoName}/issues/${issueNumber}`,
              });
            }
          } else {
            // if we are here then it is the assignee's award

            if (rematch && comment.node.author?.login === "ubiquibot") {
              payments.add({
                repoName,
                issueNumber,
                paymentAmount: parseFloat(rematch[1]),
                currency: rematch[3],
                payee: issueAssignee,
                type,
                url: `https://github.com/${org}/${repoName}/issues/${issueNumber}`,
              });

              if (issueAssignee === "No assignee") {
                noAssigneePayments.add({
                  issueNumber,
                  repoName,
                  paymentAmount: parseFloat(rematch[1]),
                  currency: rematch[3],
                  payee: issueAssignee,
                  type,
                  url: `https://github.com/${org}/${repoName}/issues/${issueNumber}`,
                });
              }
            }
          }
          continue;
        }

        if (altMatch && comment.node.author?.login === "ubiquibot") {
          const users = altMatch.input
            .match(/###### @\w+/g)
            .map((user: string) => user.split(" ")[1]);

          const payouts = altMatch.input.match(
            /\*?(\d+(\.\d+)?) \*?(XDAI|DAI|WXDAI)\*?/g
          );

          for (const user of users) {
            let usr = user.split("@")[1];

            const assigneeReward = issueAssignee === usr;
            const creatorReward = issueCreator === usr;
            const type = assigneeReward
              ? "assignee"
              : creatorReward
              ? "creator"
              : "conversation";

            payments.add({
              repoName,
              issueNumber,
              paymentAmount: parseFloat(
                payouts[users.indexOf(user)].split(" ")[0]
              ),
              currency: payouts[users.indexOf(user)].split(" ")[1],
              payee: usr,
              type,
              url: `https://github.com/${org}/${repoName}/issues/${issueNumber}`,
            });

            if (usr === "No assignee") {
              noAssigneePayments.add({
                issueNumber,
                repoName,
                paymentAmount: parseFloat(altMatch[1]),
                currency: altMatch[3],
                payee: usr,
                type,
                url: `https://github.com/${org}/${repoName}/issues/${issueNumber}`,
              });
            }
          }
          continue;
        }

        if (match) {
          console.log(`still matching: `, match);
        }

        if (altMatch) {
          const users = altMatch.input
            .match(/###### @\w+/g)
            .map((user: string) => user.split(" ")[1]);

          const payouts = altMatch.input.match(
            /\*?(\d+(\.\d+)?) \*?(XDAI|DAI|WXDAI)\*?/g
          );

          for (const user of users) {
            let usr = user.split("@")[1];

            const assigneeReward = issueAssignee === usr;
            const creatorReward = issueCreator === usr;
            const type = assigneeReward
              ? "assignee"
              : creatorReward
              ? "creator"
              : "conversation";

            payments.add({
              repoName,
              issueNumber,
              paymentAmount: parseFloat(
                payouts[users.indexOf(user)].split(" ")[0]
              ),
              currency: payouts[users.indexOf(user)].split(" ")[1],
              payee: usr,
              type,
              url: `https://github.com/${org}/${repoName}/issues/${issueNumber}`,
            });

            if (usr === "No assignee") {
              noAssigneePayments.add({
                issueNumber,
                repoName,
                paymentAmount: parseFloat(altMatch[1]),
                currency: altMatch[3],
                payee: usr,
                type,
                url: `https://github.com/${org}/${repoName}/issues/${issueNumber}`,
              });
            }
          }
          continue;
        }
      }
    }

    hasNextPage = response.repository.issues.pageInfo.hasNextPage;
    cursor = response.repository.issues.pageInfo.endCursor;
  }

  const data = {
    payments: Array.from(payments),
    noAssigneePayments: Array.from(noAssigneePayments),
  };

  return data;
}

export async function processRepo(
  org: string,
  repo: Repositories,
  since: string,
  oneCsv?: boolean
) {
  console.log(`Processing ${repo.name}...\n`);
  const allPayments: PaymentInfo[] = [];
  const allNoAssigneePayments: PaymentInfo[] = [];
  const noPayments: NoPayments[] = [];
  const payments = await fetchPaymentsForRepository(org, repo.name, since);

  if (payments.payments.length === 0) {
    noPayments.push({
      repoName: repo.name,
      archived: repo.isArchived,
      lastCommitDate: repo.lastCommitDate,
      message: "No payments found",
      url: `https://github.com/${org}/${repo.name}`,
    });
  }

  allPayments.push(...payments.payments);
  allNoAssigneePayments.push(...payments.noAssigneePayments);

  const contributors: Contributor = {};

  for (const payment of allPayments) {
    const username = payment.payee;
    if (username) {
      if (contributors[username]) {
        contributors[username] += payment.paymentAmount;
      } else {
        contributors[username] = payment.paymentAmount;
      }
    }
  }

  if (!oneCsv) {
    await writeCsvs(
      repo,
      contributors,
      allPayments,
      allNoAssigneePayments,
      noPayments
    );
    return;
  } else {
    return {
      repo,
      contributors,
      allPayments,
      allNoAssigneePayments,
      noPayments,
    };
  }
}

async function writeCsvs(
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
      const rawBalanceCsv = await jsonToCSV(csv);

      await writeToFile(`${repo.name}-raw-balances.csv`, rawBalanceCsv);
    }
  } catch (err) {
    console.log(err);
  }

  try {
    if (allPayments.length === 0) {
      console.log("No payments found for this repo.");
    } else {
      const allPaymentsCsv = await jsonToCSV(
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
      const noAssigneeCsv = await jsonToCSV(
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
      const noPaymentsCsv = await jsonToCSV(
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

  try {
    if (allNoAssigneePayments.length === 0) {
      console.log("No manual checks required.");
    } else {
      await writeToFile(
        `${repo.name}-manual-checks-required.json`,
        JSON.stringify(
          allNoAssigneePayments.sort(
            (a: { issueNumber: number }, b: { issueNumber: number }) =>
              a.issueNumber - b.issueNumber
          ),
          null,
          2
        )
      );
    }
  } catch (err) {
    console.log(err);
  }
}

export async function processRepositories(
  org: string,
  since: string,
  oneCsv?: boolean
): Promise<CSVData | undefined> {
  const repos = await fetchPublicRepositories(org);

  if (!oneCsv) {
    for (const repo of repos) {
      await processRepo(org, repo, since);
    }
    return;
  } else {
    const processedRepos: CSVData = {
      contributors: {},
      allPayments: [],
      allNoAssigneePayments: [],
      noPayments: [],
    };

    for (const repo of repos) {
      const processed = await processRepo(org, repo, since, oneCsv);
      if (!processed) {
        console.log(`No data for ${repo.name}`);
        continue;
      }

      processedRepos.allPayments.push(...processed.allPayments);
      processedRepos.noPayments.push(...processed.noPayments);

      for (const [username, balance] of Object.entries(
        processed.contributors
      )) {
        if (processedRepos.contributors[username]) {
          processedRepos.contributors[username] += balance;
        } else {
          processedRepos.contributors[username] = balance;
        }
      }

      processedRepos.allNoAssigneePayments.push(
        ...processed.allNoAssigneePayments
      );
    }

    return processedRepos;
  }
}

async function loadingBar() {
  const frames = ["| ", "/ ", "- ", "\\ "];
  let i = 0;
  return setInterval(() => {
    process.stdout.write("\r" + frames[i++]);
    i &= 3;
  }, 100);
}

export async function jsonToCSV(
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

export async function invoke(timeFrom?: string) {
  const org = "Ubiquity";
  const since = timeFrom ? timeFrom : "2023-01-01T00:00:00.000Z";
  const loader = await loadingBar();

  const data: CSVData | undefined = await processRepositories(org, since, true);

  if (!data) {
    throw new Error("No data found processing all repositories.");
  }

  await writeCSV(data);

  clearInterval(loader);
  process.exit(0);
}

async function writeCSV(data: CSVData) {
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
    csv += `${group.name}\n`;
    csv += `${group.headers.join(",")}\n`;
    csv += await jsonToCSV(group.data);

    await writeToFile(
      `${process.cwd()}/${group.name.toLowerCase().replace(" ", "_")}.csv`,
      csv
    );
  }
}

export async function writeToFile(fileName: string, data: string) {
  try {
    await writeFile(fileName, data);
  } catch (err) {
    console.error(err);
  }
}
