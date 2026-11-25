import { EpsEnvironment, EpsState } from '../../models/eps';

export interface EpsGatewayPort {
  call(environment: EpsEnvironment, tool: string, args: Record<string, unknown>): Promise<unknown>;
  test(environment: EpsEnvironment): Promise<void>;
}
export interface EpsStorePort {
  load(workspace: string): Promise<EpsState>;
  save(workspace: string, state: EpsState): Promise<void>;
  exclusive<T>(workspace: string, action: () => Promise<T>): Promise<T>;
}
export interface EpsSecretsPort {
  get(environment: EpsEnvironment): Promise<string | undefined>;
  set(environment: EpsEnvironment, token: string): Promise<void>;
}
