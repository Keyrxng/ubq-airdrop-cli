import { Contributor, Repositories, fetchPublicRepositories } from "../invoke";

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

export function removeDuplicates(arr: any[]) {
  return arr.filter(
    (v, i, a) => a.findIndex((t) => t.issueNumber === v.issueNumber) === i
  );
}

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
