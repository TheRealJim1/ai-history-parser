// ERPNext API Integration
// Supports creating Projects, Tasks, Issues, Notes, and other ERPNext documents

export interface ERPNextConfig {
  baseUrl: string; // e.g., "https://your-instance.erpnext.com"
  apiKey: string;
  apiSecret: string;
}

export interface ERPNextProject {
  project_name: string;
  status?: 'Open' | 'Completed' | 'Cancelled';
  expected_start_date?: string; // YYYY-MM-DD
  expected_end_date?: string; // YYYY-MM-DD
  priority?: 'Low' | 'Medium' | 'High';
  project_type?: string; // e.g., "NPD", "Internal", "Customer"
  description?: string;
  notes?: string;
}

export interface ERPNextTask {
  subject: string;
  project?: string;
  status?: 'Open' | 'Working' | 'Pending Review' | 'Completed' | 'Cancelled';
  priority?: 'Low' | 'Medium' | 'High';
  description?: string;
  expected_start_date?: string;
  expected_end_date?: string;
  assigned_to?: string;
}

export interface ERPNextIssue {
  subject: string;
  project?: string;
  status?: 'Open' | 'Replied' | 'Hold' | 'Resolved' | 'Closed';
  priority?: 'Low' | 'Medium' | 'High';
  description?: string;
  issue_type?: 'Communication' | 'Bug' | 'Feature';
}

export interface ERPNextNote {
  title: string;
  content: string;
  reference_doctype?: string; // e.g., "Project", "Task"
  reference_docname?: string;
  note_type?: 'Note' | 'Comment';
}

class ERPNextClient {
  private config: ERPNextConfig;
  private sessionId: string | null = null;

  constructor(config: ERPNextConfig) {
    this.config = config;
  }

  // Authenticate with ERPNext
  async authenticate(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/method/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          usr: this.config.apiKey,
          pwd: this.config.apiSecret,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        // Extract session cookie
        const cookies = response.headers.get('set-cookie');
        if (cookies) {
          const match = cookies.match(/sid=([^;]+)/);
          if (match) {
            this.sessionId = match[1];
          }
        }
        return true;
      }
      return false;
    } catch (error) {
      console.error('ERPNext authentication failed:', error);
      return false;
    }
  }

  // Make authenticated API request
  private async request(method: string, endpoint: string, data?: any): Promise<any> {
    if (!this.sessionId) {
      const authenticated = await this.authenticate();
      if (!authenticated) {
        throw new Error('Failed to authenticate with ERPNext');
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.sessionId) {
      headers['Cookie'] = `sid=${this.sessionId}`;
    }

    const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ERPNext API error: ${error}`);
    }

    return response.json();
  }

  // Create a Project
  async createProject(project: ERPNextProject): Promise<string> {
    const data = {
      doctype: 'Project',
      project_name: project.project_name,
      status: project.status || 'Open',
      expected_start_date: project.expected_start_date,
      expected_end_date: project.expected_end_date,
      priority: project.priority || 'Medium',
      project_type: project.project_type,
      notes: project.notes || project.description,
    };

    const result = await this.request('POST', '/api/resource/Project', { data });
    return result.data.name;
  }

  // Create a Task
  async createTask(task: ERPNextTask): Promise<string> {
    const data = {
      doctype: 'Task',
      subject: task.subject,
      project: task.project,
      status: task.status || 'Open',
      priority: task.priority || 'Medium',
      description: task.description,
      expected_start_date: task.expected_start_date,
      expected_end_date: task.expected_end_date,
      assigned_to: task.assigned_to,
    };

    const result = await this.request('POST', '/api/resource/Task', { data });
    return result.data.name;
  }

  // Create an Issue
  async createIssue(issue: ERPNextIssue): Promise<string> {
    const data = {
      doctype: 'Issue',
      subject: issue.subject,
      project: issue.project,
      status: issue.status || 'Open',
      priority: issue.priority || 'Medium',
      description: issue.description,
      issue_type: issue.issue_type || 'Communication',
    };

    const result = await this.request('POST', '/api/resource/Issue', { data });
    return result.data.name;
  }

  // Create a Note/Comment
  async createNote(note: ERPNextNote): Promise<string> {
    const data = {
      doctype: 'Comment',
      comment_type: note.note_type || 'Comment',
      reference_doctype: note.reference_doctype || 'Project',
      reference_name: note.reference_docname,
      content: `**${note.title}**\n\n${note.content}`,
    };

    const result = await this.request('POST', '/api/resource/Comment', { data });
    return result.data.name;
  }

  // Push Collection as ERPNext Project (NPD or other)
  async pushCollectionAsProject(
    collectionName: string,
    collectionContent: string,
    collectionTags: string[],
    projectType: string = 'NPD'
  ): Promise<{ projectId: string; tasks: string[] }> {
    // Create project
    const project = await this.createProject({
      project_name: collectionName,
      project_type: projectType,
      description: collectionContent.substring(0, 500), // First 500 chars
      notes: collectionContent,
      status: 'Open',
      priority: 'Medium',
    });

    // Create tasks from collection content (split by sections)
    const tasks: string[] = [];
    const sections = collectionContent.split(/\n\n---\n\n/);
    
    for (let i = 0; i < Math.min(sections.length, 10); i++) {
      const section = sections[i].trim();
      if (section.length > 20) {
        const taskSubject = section.split('\n')[0].substring(0, 100) || `Task ${i + 1}`;
        const task = await this.createTask({
          subject: taskSubject,
          project: project,
          description: section,
          status: 'Open',
          priority: 'Medium',
        });
        tasks.push(task);
      }
    }

    // Add tags as notes
    if (collectionTags.length > 0) {
      await this.createNote({
        title: 'Tags',
        content: collectionTags.join(', '),
        reference_doctype: 'Project',
        reference_docname: project,
      });
    }

    return { projectId: project, tasks };
  }
}

export function createERPNextClient(config: ERPNextConfig): ERPNextClient {
  return new ERPNextClient(config);
}

