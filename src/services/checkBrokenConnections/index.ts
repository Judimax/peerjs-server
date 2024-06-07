import WebSocket from "ws";
import type { IConfig } from "../../config/index.ts";
import type { IClient } from "../../models/client.ts";
import type { IRealm } from "../../models/realm.ts";
import { Socket } from "socket.io";

const DEFAULT_CHECK_INTERVAL = 300;

type CustomConfig = Pick<IConfig, "alive_timeout">;

export class CheckBrokenConnections {
	public readonly checkInterval: number;
	private timeoutId: NodeJS.Timeout | null = null;
	private readonly realm: IRealm;
	private readonly config: CustomConfig;
	private readonly onClose?: (client: IClient) => void;

	constructor({
		realm,
		config,
		checkInterval = DEFAULT_CHECK_INTERVAL,
		onClose,
	}: {
		realm: IRealm;
		config: CustomConfig;
		checkInterval?: number;
		onClose?: (client: IClient) => void;
	}) {
		this.realm = realm;
		this.config = config;
		this.onClose = onClose;
		this.checkInterval = checkInterval;
	}

	public start(): void {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
		}

		this.timeoutId = setTimeout(() => {
			this.checkConnections();

			this.timeoutId = null;

			this.start();
		}, this.checkInterval);
	}

	public stop(): void {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
	}

	private checkConnections(): void {
		const clientsIds = this.realm.getClientsIds();

		const now = new Date().getTime();
		const { alive_timeout: aliveTimeout } = this.config;

		for (const clientId of clientsIds) {
			const client = this.realm.getClientById(clientId);

			if (!client) continue;

			const timeSinceLastPing = now - client.getLastPing();

			if (timeSinceLastPing < aliveTimeout) continue;

			try {
				const socket = client.getSocket()
				if (socket instanceof WebSocket) {
					socket?.close();
				} else if (socket instanceof Socket){
					socket?.disconnect()
				}
			} finally {
				this.realm.clearMessageQueue(clientId);
				this.realm.removeClientById(clientId);

				client.setSocket(null);

				this.onClose?.(client);
			}
		}
	}
}
