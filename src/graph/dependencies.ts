export interface DependencyNode {
  id: string;
  required: string[];
}

type DependencyGraph = Map<string, string[]>;

export function validateDependencyGraph(nodes: DependencyNode[]): void {
  const graph = createDependencyGraph(nodes);
  rejectCycles(graph);
}

export function resolvePackClosure(packId: string, nodes: DependencyNode[]): string[] {
  const graph = createDependencyGraph(nodes);
  rejectCycles(graph);

  if (!graph.has(packId)) {
    throw new Error(`Unknown dependency node ID: ${packId}`);
  }

  const resolved = new Set<string>();
  const closure: string[] = [];
  const visit = (id: string): void => {
    if (resolved.has(id)) {
      return;
    }

    resolved.add(id);
    for (const dependency of graph.get(id) ?? []) {
      visit(dependency);
    }
    closure.push(id);
  };

  visit(packId);
  return closure;
}

function createDependencyGraph(nodes: DependencyNode[]): DependencyGraph {
  const sortedNodes = [...nodes].sort((left, right) => compareIds(left.id, right.id));
  const graph: DependencyGraph = new Map();
  for (const node of sortedNodes) {
    if (graph.has(node.id)) {
      throw new Error(`Duplicate dependency node ID: ${node.id}`);
    }
    graph.set(node.id, []);
  }

  for (const node of sortedNodes) {
    const dependencies = graph.get(node.id);
    if (dependencies === undefined) {
      throw new Error(`Unknown dependency node ID: ${node.id}`);
    }

    for (const dependency of [...node.required].sort(compareIds)) {
      if (!graph.has(dependency)) {
        throw new Error(`Unknown required dependency ID: ${dependency} (required by ${node.id})`);
      }
      dependencies.push(dependency);
    }
    dependencies.sort(compareIds);
  }

  return graph;
}

function rejectCycles(graph: DependencyGraph): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  const visit = (id: string): void => {
    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      const cycle = [...path.slice(cycleStart), id];
      throw new Error(`Dependency cycle: ${cycle.join(" -> ")}`);
    }
    if (visited.has(id)) {
      return;
    }

    visiting.add(id);
    path.push(id);
    for (const dependency of graph.get(id) ?? []) {
      visit(dependency);
    }
    path.pop();
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of [...graph.keys()].sort(compareIds)) {
    visit(id);
  }
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
