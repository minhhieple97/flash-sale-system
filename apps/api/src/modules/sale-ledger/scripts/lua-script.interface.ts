export type ScriptArgs = (string | number)[];

export interface LuaScript<Name extends string, Args extends ScriptArgs> {
  readonly name: Name;
  readonly numberOfKeys: number;
  readonly lua: string;
  readonly args?: Args;
}
