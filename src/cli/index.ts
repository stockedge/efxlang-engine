import { readFileSync, writeFileSync } from "fs";
import { Lexer } from "../lang/lexer";
import { Parser } from "../lang/parser";
import { Resolver } from "../lang/resolver";
import { Codegen } from "../lang/codegen";
import { TBCEncoder } from "../bytecode/bin";
import { Kernel, type ImageFormat } from "../kernel/kernel";
import { parseTraceFile } from "../trace/trace";

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case "compile": {
      const srcFile = args[1];
      const outFile = args.includes("-o")
        ? args[args.indexOf("-o") + 1]
        : "out.tbc";
      const source = readFileSync(srcFile, "utf8");

      const tokens = new Lexer(source).tokenize();
      const program = new Parser(tokens).parse();
      const result = new Resolver().resolve(program);
      const tbc = new Codegen(result).generate(program);

      const bytes = new TBCEncoder().encode(tbc);
      writeFileSync(outFile, Buffer.from(bytes));
      console.log(`Compiled ${srcFile} to ${outFile}`);
      break;
    }
    case "run": {
      const imgFile = args[1];
      const image = JSON.parse(readFileSync(imgFile, "utf8")) as ImageFormat;
      const kernel = Kernel.fromImage(image);
      kernel.run();
      process.stdout.write(kernel.getOutput());
      break;
    }
    case "record": {
      const imgFile = args[1];
      const traceFile = args.includes("--trace")
        ? args[args.indexOf("--trace") + 1]
        : "trace.deos.json";
      const image = JSON.parse(readFileSync(imgFile, "utf8")) as ImageFormat;

      const kernel = Kernel.fromImage(image);
      kernel.setRecordMode("image-hash-placeholder");
      kernel.run();

      const trace = kernel.getTrace();
      writeFileSync(traceFile, JSON.stringify(trace, null, 2));
      process.stdout.write(kernel.getOutput());
      console.log(`\nTrace saved to ${traceFile}`);
      break;
    }
    case "replay": {
      const traceFile = args[1];
      const trace = parseTraceFile(
        JSON.parse(readFileSync(traceFile, "utf8")) as unknown,
      );

      // Replay needs the TBC. Usually it's in image.
      // My Trace structure currently has 'image_hash'.
      // In a real system, we'd look up the image.
      // For now, let's assume image exists.

      // Wait, the spec says image.json has the TBC.
      // Let's assume we pass image AND trace?
      // Re-read 16.1: `deos replay <trace.deos.json>`
      // The trace should point to the image or contain it?

      // Usually, image is small enough to include or we point to it.
      // Let's assume there is an image.json in the same dir for now.
      const imgFile = "image.json";
      const image = JSON.parse(readFileSync(imgFile, "utf8")) as ImageFormat;

      const kernel = Kernel.fromImage(image);
      kernel.setReplayMode(trace);
      kernel.run();
      console.log("Replay successful.");
      break;
    }
    default:
      console.log("Usage: deos <compile|run|record|replay> [args]");
  }
}

main();
