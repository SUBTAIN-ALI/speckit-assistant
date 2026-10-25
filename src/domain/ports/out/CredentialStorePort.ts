import { IntegrationCredentials } from '../../models/credentials';

export interface CredentialStorePort {
  load(): Promise<IntegrationCredentials>;
  save(credentials: IntegrationCredentials): Promise<void>;
}
