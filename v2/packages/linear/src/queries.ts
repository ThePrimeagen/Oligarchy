export const TEAM =
  "query ExperimentTeam($name: String!) { teams(filter: { name: { eq: $name } }, first: 1) { nodes { id } } }";

export const LABEL =
  "query ExperimentLabel($name: String!, $teamId: ID!) { issueLabels(filter: { name: { eq: $name }, team: { id: { eq: $teamId } } }, first: 1) { nodes { id } } }";

export const LABEL_CREATE = `mutation ExperimentLabelCreate($input: IssueLabelCreateInput!) {
  issueLabelCreate(input: $input) {
    success
    issueLabel {
      id
    }
  }
}`;

export const ASSIGNEE =
  "query ExperimentAssignee($email: String!) { users(filter: { email: { eq: $email } }, first: 1) { nodes { id } } }";

export const STATE =
  "query ExperimentState($name: String!, $teamId: ID!) { workflowStates(filter: { name: { eq: $name }, team: { id: { eq: $teamId } } }, first: 1) { nodes { id } } }";

// A ticket Linear does not know is a 200 with one error and a null data.
export const TICKET_STATE =
  "query ExperimentTicketState($ticket: String!, $state: String!) { issue(id: $ticket) { team { states(filter: { name: { eq: $state } }, first: 1) { nodes { id } } } } }";

export const ISSUE_STATE =
  "query ExperimentIssueState($id: String!) { issue(id: $id) { state { id } } }";

export const ISSUE_CREATE = `mutation ExperimentIssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue {
      id
      identifier
      url
    }
  }
}`;

export const ISSUE_UPDATE = `mutation ExperimentIssueUpdate($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
  }
}`;

export const COMMENT_CREATE = `mutation ExperimentCommentCreate($input: CommentCreateInput!) {
  commentCreate(input: $input) {
    success
  }
}`;

export const ISSUES = `query ExperimentIssues($filter: IssueFilter!, $after: String) {
  issues(first: 100, after: $after, filter: $filter) {
    nodes {
      id
      identifier
      title
      url
      updatedAt
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;
