import fs from "node:fs";
import path from "node:path";

/** Tiny JSON file store for demo persistence (a database in production). */
export function jsonStore<T>(name: string, empty: T) {
  const file = path.resolve(process.cwd(), `data/${name}.json`);
  return {
    read(): T {
      if (!fs.existsSync(file)) return structuredClone(empty);
      return JSON.parse(fs.readFileSync(file, "utf8")) as T;
    },
    write(mutate: (t: T) => void): T {
      const t = this.read();
      mutate(t);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(t, null, 2) + "\n");
      return t;
    },
  };
}
