import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { actorKey, ddb, movieKey, type Role, tableName } from "../shared/db";
import { isResponse, parseJsonObject, response } from "../shared/http";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const body = parseJsonObject(event);
  if (isResponse(body)) return body;

  const role: Role = {
    movieId: body.movieId as number,
    actorId: body.actorId as number,
    roleName: body.roleName as string,
    roleDescription: body.roleDescription as string,
  };

  if (!Number.isInteger(role.movieId) || role.movieId <= 0) {
    return response(400, { message: "movieId must be a positive integer" });
  }
  if (!Number.isInteger(role.actorId) || role.actorId <= 0) {
    return response(400, { message: "actorId must be a positive integer" });
  }
  if (typeof role.roleName !== "string" || role.roleName.trim() === "") {
    return response(400, { message: "roleName must be a non-empty string" });
  }
  if (typeof role.roleDescription !== "string") {
    return response(400, { message: "roleDescription must be a string" });
  }

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: tableName,
              Key: { PK: movieKey(role.movieId), SK: movieKey(role.movieId) },
              ConditionExpression: "attribute_exists(PK)",
            }
          },
          {
            ConditionCheck: {
              TableName: tableName,
              Key: { PK: actorKey(role.actorId), SK: actorKey(role.actorId) },
              ConditionExpression: "attribute_exists(PK)",
            }
          },
          {
            Put: {
              TableName: tableName,
              Item: {
                PK: movieKey(role.movieId),
                SK: actorKey(role.actorId),
                ...role,
              },
              ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            },
          },
        ],
      })
    );
    return response(201, { message: "Role added", data: role });
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      const failedIndex = err.CancellationReasons?.findIndex(
        (reason) => reason.Code === "ConditionalCheckFailed"
      );
      if (failedIndex === 0) return response(404, { message: `Movie ${role.movieId} not found` });
      if (failedIndex === 1) return response(404, { message: `Actor ${role.actorId} not found` });
      if (failedIndex === 2) return response(409, { message: "This role already exists" });
    }
    console.error("DynamoDB error:", err);
    return response(500, {
      message: "Internal server error",
    });
  }
};
