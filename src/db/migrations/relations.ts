import { relations } from "drizzle-orm/relations";
import { users, userPasswords, userOauthAccounts, sessions, friendRequests, posts, postMedia, postReactions, conversations, messages, messageReactions, userDevices, passwordResetCodes, friendships, postVisibility, postViews } from "./schema";

export const userPasswordsRelations = relations(userPasswords, ({one}) => ({
	user: one(users, {
		fields: [userPasswords.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	userPasswords: many(userPasswords),
	userOauthAccounts: many(userOauthAccounts),
	sessions: many(sessions),
	friendRequests_requesterId: many(friendRequests, {
		relationName: "friendRequests_requesterId_users_id"
	}),
	friendRequests_receiverId: many(friendRequests, {
		relationName: "friendRequests_receiverId_users_id"
	}),
	posts: many(posts),
	postReactions: many(postReactions),
	conversations_userLow: many(conversations, {
		relationName: "conversations_userLow_users_id"
	}),
	conversations_userHigh: many(conversations, {
		relationName: "conversations_userHigh_users_id"
	}),
	messages: many(messages),
	messageReactions: many(messageReactions),
	userDevices: many(userDevices),
	passwordResetCodes: many(passwordResetCodes),
	friendships_userLow: many(friendships, {
		relationName: "friendships_userLow_users_id"
	}),
	friendships_userHigh: many(friendships, {
		relationName: "friendships_userHigh_users_id"
	}),
	postVisibilities: many(postVisibility),
	postViews: many(postViews),
}));

export const userOauthAccountsRelations = relations(userOauthAccounts, ({one}) => ({
	user: one(users, {
		fields: [userOauthAccounts.userId],
		references: [users.id]
	}),
}));

export const sessionsRelations = relations(sessions, ({one}) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id]
	}),
}));

export const friendRequestsRelations = relations(friendRequests, ({one}) => ({
	user_requesterId: one(users, {
		fields: [friendRequests.requesterId],
		references: [users.id],
		relationName: "friendRequests_requesterId_users_id"
	}),
	user_receiverId: one(users, {
		fields: [friendRequests.receiverId],
		references: [users.id],
		relationName: "friendRequests_receiverId_users_id"
	}),
}));

export const postsRelations = relations(posts, ({one, many}) => ({
	user: one(users, {
		fields: [posts.authorId],
		references: [users.id]
	}),
	postMedias: many(postMedia),
	postReactions: many(postReactions),
	messages: many(messages),
	postVisibilities: many(postVisibility),
	postViews: many(postViews),
}));

export const postMediaRelations = relations(postMedia, ({one}) => ({
	post: one(posts, {
		fields: [postMedia.postId],
		references: [posts.id]
	}),
}));

export const postReactionsRelations = relations(postReactions, ({one}) => ({
	post: one(posts, {
		fields: [postReactions.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [postReactions.userId],
		references: [users.id]
	}),
}));

export const conversationsRelations = relations(conversations, ({one, many}) => ({
	user_userLow: one(users, {
		fields: [conversations.userLow],
		references: [users.id],
		relationName: "conversations_userLow_users_id"
	}),
	user_userHigh: one(users, {
		fields: [conversations.userHigh],
		references: [users.id],
		relationName: "conversations_userHigh_users_id"
	}),
	messages: many(messages),
}));

export const messagesRelations = relations(messages, ({one, many}) => ({
	conversation: one(conversations, {
		fields: [messages.conversationId],
		references: [conversations.id]
	}),
	user: one(users, {
		fields: [messages.senderId],
		references: [users.id]
	}),
	post: one(posts, {
		fields: [messages.referencedPostId],
		references: [posts.id]
	}),
	messageReactions: many(messageReactions),
}));

export const messageReactionsRelations = relations(messageReactions, ({one}) => ({
	message: one(messages, {
		fields: [messageReactions.messageId],
		references: [messages.id]
	}),
	user: one(users, {
		fields: [messageReactions.userId],
		references: [users.id]
	}),
}));

export const userDevicesRelations = relations(userDevices, ({one}) => ({
	user: one(users, {
		fields: [userDevices.userId],
		references: [users.id]
	}),
}));

export const passwordResetCodesRelations = relations(passwordResetCodes, ({one}) => ({
	user: one(users, {
		fields: [passwordResetCodes.userId],
		references: [users.id]
	}),
}));

export const friendshipsRelations = relations(friendships, ({one}) => ({
	user_userLow: one(users, {
		fields: [friendships.userLow],
		references: [users.id],
		relationName: "friendships_userLow_users_id"
	}),
	user_userHigh: one(users, {
		fields: [friendships.userHigh],
		references: [users.id],
		relationName: "friendships_userHigh_users_id"
	}),
}));

export const postVisibilityRelations = relations(postVisibility, ({one}) => ({
	post: one(posts, {
		fields: [postVisibility.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [postVisibility.viewerId],
		references: [users.id]
	}),
}));

export const postViewsRelations = relations(postViews, ({one}) => ({
	post: one(posts, {
		fields: [postViews.postId],
		references: [posts.id]
	}),
	user: one(users, {
		fields: [postViews.userId],
		references: [users.id]
	}),
}));