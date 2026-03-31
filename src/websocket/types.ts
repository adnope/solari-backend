import type { SendMessageResult } from "../usecases/conversations/send_message.ts";

export type WsNewMessageEvent = {
  type: "NEW_MESSAGE";
  payload: {
    conversationId: string;
    message: SendMessageResult;
  };
};

export type WsServerEvent = WsNewMessageEvent;
