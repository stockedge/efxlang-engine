export enum Opcode {
  // Basic
  CONST = 0x01,
  POP = 0x02,
  DUP = 0x03,
  SWAP = 0x04,
  LOAD = 0x05,
  STORE = 0x06,
  JMP = 0x07,
  JMPF = 0x08,
  CLOSURE = 0x09,
  CALL = 0x0a,
  RET = 0x0b,
  SYS = 0x0c,
  SAFEPOINT = 0x0d,
  HALT = 0x0e,

  // Arithmetic (number only)
  ADD = 0x10,
  SUB = 0x11,
  MUL = 0x12,
  DIV = 0x13,
  EQ = 0x14,
  LT = 0x15,
  GT = 0x16,

  // Effect Handlers
  PUSH_HANDLER = 0x20,
  POP_HANDLER = 0x21,
  PERFORM = 0x22,
  HANDLE_DONE = 0x23,
}

export enum SyscallType {
  SYS_PUTC = 1,
  SYS_GETC = 2,
  SYS_YIELD = 3,
  SYS_SLEEP = 4,
  SYS_EXIT = 5,
  SYS_PRINT = 7,
}
