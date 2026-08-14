import path from "node:path";
import fg from "fast-glob";
import { ArchitectureError } from "./errors.js";
import type { ArchitectureConfig } from "./types.js";

export interface ClassifiedFile {
  path: string;
  absolutePath: string;
  domain: string | undefined;
  component: string | undefined;
}

export async function discoverAndClassifyFiles(
  projectRoot: string,
  config: ArchitectureConfig,
): Promise<readonly ClassifiedFile[]> {
  const options = {
    cwd: projectRoot,
    absolute: false,
    onlyFiles: true,
    unique: true,
    dot: true,
    followSymbolicLinks: false,
    ignore: [...config.exclude],
  };

  const discovered = (await fg([...config.include], options)).map(toPortablePath).sort();
  const discoveredSet = new Set(discovered);
  const componentMatches = new Map<string, string[]>();
  const domainMatches = new Map<string, string[]>();

  for (const component of config.components) {
    const matches = await fg([...component.match], options);

    for (const candidate of matches) {
      const file = toPortablePath(candidate);
      if (!discoveredSet.has(file)) continue;

      const matchedComponents = componentMatches.get(file) ?? [];
      matchedComponents.push(component.name);
      componentMatches.set(file, matchedComponents);
    }
  }

  for (const domain of config.domains) {
    if (domain.root !== undefined) {
      for (const file of discovered) {
        if (domain.root === "." || file.startsWith(`${domain.root}/`)) {
          addMatch(domainMatches, file, domain.name);
        }
      }
      continue;
    }

    const matches = await fg([...domain.match], options);
    for (const candidate of matches) {
      const file = toPortablePath(candidate);
      if (discoveredSet.has(file)) addMatch(domainMatches, file, domain.name);
    }
  }

  return discovered.map((file) => {
    const matches = componentMatches.get(file) ?? [];
    const matchedDomains = domainMatches.get(file) ?? [];

    if (matches.length > 1) {
      throw new ArchitectureError(
        `File "${file}" matches multiple components: ${matches.sort().join(", ")}.`,
      );
    }


    if (matchedDomains.length > 1) {
      throw new ArchitectureError(
        `File "${file}" matches multiple domains: ${matchedDomains.sort().join(", ")}.`,
      );
    }

    return {
      path: file,
      absolutePath: path.join(projectRoot, ...file.split("/")),
      domain: matchedDomains[0],
      component: matches[0],
    };
  });
}

function addMatch(matches: Map<string, string[]>, file: string, name: string): void {
  const values = matches.get(file) ?? [];
  values.push(name);
  matches.set(file, values);
}

function toPortablePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}
