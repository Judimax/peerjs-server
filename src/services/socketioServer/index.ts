import { Server as IOServer, Socket } from "socket.io";
import { EventEmitter } from "events";
import { Errors, MessageType } from "../../enums.ts";
import { IConfig } from "../../config/index.ts";
import { IClient, Client } from "../../models/client.ts";
import { IMessage } from "../../models/message.ts";
import { IRealm } from "../../models/realm.ts";
import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import { CorsOptions } from "cors";

export interface ISocketIOServer extends EventEmitter {
  readonly path: string;
}

type CustomConfig = Pick<IConfig, "path" | "key" | "concurrent_limit">;

const WS_PATH = "peerjs";

export class SocketIOServer extends EventEmitter implements ISocketIOServer {
  public readonly path: string;
  private readonly realm: IRealm;
  private readonly config: CustomConfig;
  public readonly socketServer: IOServer;

  constructor({
    server,
    realm,
    config,
  }: {
    server: HttpServer | HttpsServer;
    realm: IRealm;
    config: CustomConfig;
  }) {
    super();

    this.setMaxListeners(0);

    this.realm = realm;
    this.config = config;

    const path = this.config.path;
    this.path = `${path}${path.endsWith("/") ? "" : "/"}${WS_PATH}`;

    this.socketServer = new IOServer(server, {
      cors: {
        origin: config.corsOptions.origin ? "*":"",
        // origin:"*"
      },
    }).of("/peerjs");

    this.socketServer.on("connection", (socket) => {
      this._onSocketConnection(socket);
    });

    this.socketServer.on("error", (error) => {
      this._onSocketError(error);
    });
  }

  private _onSocketConnection(socket: Socket): void {

    this.socketServer.on("error", (error) => {
      this._onSocketError(error);
    });

    const {  token, key } = socket.handshake.query;
    const id = socket.id

    if ( !id || !token || !key) {
      this._sendErrorAndClose(socket, Errors.INVALID_WS_PARAMETERS);
      return;
    }

    if (key !== this.config.key) {
      this._sendErrorAndClose(socket, Errors.INVALID_KEY);
      return;
    }

    const client = this.realm.getClientById(id);

    if (client) {
      if (token !== client.getToken()) {
        socket.emit("message", {type:MessageType.ID_TAKEN, msg: "ID is taken" });
        socket.disconnect();
        return;
      }

      this._configureSocket(socket, client);
      return;
    }

    this._registerClient({ socket, id, token });
  }

  private _onSocketError(error: Error): void {
    this.emit("error", error);
  }

  private _registerClient({
    socket,
    id,
    token,
  }: {
    socket: Socket;
    id: string;
    token: string;
  }): void {
    const clientsCount = this.realm.getClientsIds().length;

    if (clientsCount >= this.config.concurrent_limit) {
      this._sendErrorAndClose(socket, Errors.CONNECTION_LIMIT_EXCEED);
      return;
    }

    const newClient: IClient = new Client({ id, token });
    this.realm.setClient(newClient, id);
    socket.emit("message",{type:MessageType.OPEN});

    this._configureSocket(socket, newClient);
  }

  private _configureSocket(socket: Socket, client: IClient): void {
    client.setSocket(socket);

    socket.on("disconnect", () => {
      if (client.getSocket() === socket) {
        this.realm.removeClientById(client.getId());
        this.emit("close", client);
      }
    });

    socket.on("message", (data) => {
      try {
        let message:Writable<IMessage> ;
        if(typeof data === "string"){
          message = JSON.parse(data)
        } else{
          message = data
        }
        message.src = client.getId();
        this.emit("message", client, message);
      } catch (e) {
        this.emit("error", e);
      }
    });

    this.emit("connection", client);
  }

  private _sendErrorAndClose(socket: Socket, msg: Errors): void {
    socket.emit("message", { type:MessageType.ERROR,msg });
    socket.disconnect();
  }
}

type Writable<T> = {
  -readonly [K in keyof T]: T[K];
};
