export interface AppSettings {
  localToken: string | null;
  tcpBind: string | null;
  headless: boolean | null;
}

export interface AppSettingsUpdate {
  localToken?: string | null;
  tcpBind?: string | null;
  headless?: boolean | null;
}

export interface TcpStatus {
  enabled: boolean;
  bind: string | null;
}
