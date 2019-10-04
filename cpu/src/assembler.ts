#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as process from 'process';

function main(argv: string[]): number {
  if (argv.length !== 3) {
    console.error('Usage: ts-node assembler.ts file.mx');
    return 1;
  }

  if (!argv[2].match(/.*\.mx/)) {
    console.error(`Input file must have extension '.mx', give ${argv[2]}`);
    return 1;
  }

  // Read file from argv[2] with extension .mx
  const code: string = fs.readFileSync(argv[2]).toString('utf-8');
  // Assemble bytes
  const exe: string = assemble(code);
  // Save bytes to same filename with ext replaced with .o
  fs.writeFileSync(argv[2].replace(/(.*)\.mx/, '$1.o'), exe);

  return 0;
}

const instructionSet: Record<
  string,
  { byte: string; op1?: string; op2?: string; desc: string }
> = {
  setpc: {
    byte: 'B1',
    op1: 'byte #',
    desc: 'Set PC to byte #',
  },
  jumpr: {
    byte: 'B2',
    op1: 'Memory slot [00-0F]',
    op2: 'byte #',
    desc:
      'If accumulator equals register (op1), jump to byte (op2), otherwise, advance program counter 3 bytes (to next instruction)',
  },
  jumpv: {
    byte: 'B3',
    op1: 'Value',
    op2: 'byte #',
    desc:
      'If accumulator equals value (op1), jump to byte (op2), otherwise, advance program counter 3 bytes (to next instruction)',
  },
  accr: {
    byte: 'C0',
    op1: 'Memory slot [00-0F]',
    desc: 'Add memory slot value to accumulator',
  },
  accv: {
    byte: 'C1',
    op1: 'Value to add to accumulator',
    desc: 'Add value to accumulator',
  },
  inc: {
    byte: 'C2',
    desc: 'Increment the counter',
  },
  dec: {
    byte: 'C3',
    desc: 'Decrement the counter',
  },
  res: {
    byte: 'C4',
    desc: 'Reset the counter to zero',
  },
  ctoa: {
    byte: 'C5',
    desc: 'Copy counter to accumulator',
  },
  atoc: {
    byte: 'C6',
    desc: 'Copy accumulator to counter',
  },
  rtoa: {
    byte: 'D0',
    op1: 'Memory slot [00-0F]',
    desc: 'Copy memory slot value to accumulator',
  },
  vtoa: {
    byte: 'D1',
    op1: 'Value',
    desc: 'Set accumulator to value',
  },
  ator: {
    byte: 'D2',
    op1: 'Memory slot [00-0F]',
    desc: 'Store accumulator in memory slot',
  },
  halt: {
    byte: '00',
    desc: 'Halt program execution',
  },
};

const instrumap: Record<string, string> = Object.keys(instructionSet).reduce(
  (acc: Record<string, string>, key) => {
    acc[key] = instructionSet[key].byte;
    return acc;
  },
  {}
);

/**
 * Assemble bytecode from the given assembly.
 *
 * @param doc the assembly
 * @returns space delimited single line string of uppercase hex-encoded bytes
 */
function assemble(doc: string): string {
  if (isValid(doc)) {
    let work = doc;
    // Strip comments
    work = stripComments(work);
    // Split sections
    const sections = splitSections(work);

    // Build symbol map
    const symmap = buildSymMap(sections.syms);
    // Build label map
    const labelmap = buildLabelMap(sections.code);

    work = sections.code;
    // Substitute symbols
    work = substitute(work, symmap);
    // Substitute labels
    work = substitute(work, labelmap);
    // Substitute instructions
    work = substitute(work, instrumap);

    // Strip labels
    work = stripLabels(work);

    return work;
  }

  return "I'm not executable";
}

/**
 * Check the given human-readable document against a few requirements
 *
 * 1. The file is divided into 3 sections each separated by `/^\s*---+\s*$/`
 *   1. The first section is plain text to be discarded
 *   2. The second section are the symbol defs giving names to the registers
 *     1. A `SYMDEF` line conforms to `/^\s*[A-Z_]+ +0[0-9a-f]\s*$/`
 *   3. The final section is the code
 *     1. A `CODE` line conforms to
 *        `/^\s*([A-Z_]+:)?\s*[a-z]+( +([A-Z_]+|[0-9a-f]+)){0,2}\s*$/`
 * 2. Any line in sections 2 & 3 can end with a comment conforming to `/#.*$/`
 *
 * @param doc the document to be checked
 * @returns `true` if all the above are satisfied, `false` otherwise
 */
function isValid(doc: string): boolean {
  const sections = doc.split(/ *---+ */);
  return (
    sections.length === 3 &&
    sections[1]
      .split('\n')
      .map(line => line.match(/^(\s*[A-Z_]+ +0[0-9a-f]\s*)?\s*(#.*)?$/))
      .reduce((a: boolean, b) => a && b !== null, true) &&
    sections[2]
      .split('\n')
      .map(line =>
        line.match(
          /^(\s*([A-Z_]+:)?\s*[a-z]+( +([A-Z_]+|[0-9a-f]+)){0,2}\s*)?\s*(#.*)?$/
        )
      )
      .reduce((a: boolean, b) => a && b !== null, true)
  );
}

/**
 * Remove all comment strings from every line of the given document trimming
 * the remaining trailing whitespace
 *
 * @param doc the document to be cleansed
 * @returns the same document with no comments or trailing line whitespace
 */
function stripComments(doc: string): string {
  return doc.replace(/#.*$/gm, '');
}

/**
 * Remove all labels from the start of code lines trimming the remaining leading
 * whitespace
 *
 * @param code the code section of the program document
 * @returns a new code section without label markers and leading whitespace
 */
function stripLabels(code: string): string {
  return code;
}

/**
 * Divide the given document into its 3 parts trimming leading and trailing
 * whitespace from each
 *
 * @param doc the document to be split
 * @returns the document split
 */
function splitSections(
  doc: string
): { desc: string; syms: string; code: string } {
  const sections = doc.split(/ *---+ */);
  return {
    desc: sections[0].trim(),
    syms: sections[1].trim(),
    code: sections[2].trim(),
  }
}

/**
 * Construct a mapping from symbol name (`/[A-Z_]+/`) to register number
 * (`/0[0-9a-f]/`)
 *
 * @param syms the SYMDEFs section of the program document
 * @retuns an object whose properties are the symbols whose values are their
 *   byte representation
 */
function buildSymMap(syms: string): Record<string, string> {
  return {};
}

/**
 * Construct a mapping from labels which can prefix a line of code to byte
 * number in the program, calculated dynamically.
 *
 * @param code the Code section of the program document
 * @retuns an object whose properties are the labels whose values are their
 *   byte representation
 */
function buildLabelMap(code: string): Record<string, string> {
  return {};
}

/**
 * Replaces any instances of the properties of `map` with their corresponding
 * value in `code`.
 *
 * @param code the Code section of the program document
 * @param map either a symmap or a lablemap
 * @returns a new code section string
 */
function substitute(code: string, map: Record<string, string>): string {
  return code;
}

if (require.main === module) {
  process.exit(main(process.argv));
}
