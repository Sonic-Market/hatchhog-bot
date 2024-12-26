import axios from 'axios'
import {SUBGRAPH_URL} from "../config.ts";

export async function fetchFromSubgraph<T>(
  operationName: string,
  query: string,
  variables: {},
): Promise<T> {
  const response = await axios.post(
    SUBGRAPH_URL,
    {
      query,
      variables,
      operationName,
    },
    {
      timeout: 2000,
    },
  )

  if (response.status === 200) {
    return response.data
  } else {
    throw new Error((response.data as any).errors || 'Failed to fetch data')
  }
}
