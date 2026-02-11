#include "init.h"

void load_network(model& our_model)
{
	fstream network_file;
	int num_points;
	int degree;
	int edge_index;
	Point p;
	vector<int> tempVector;
	

	network_file.open(our_model.network_fileName);
	// network_file.open("./datasets/San_Francisco/San_Francisco_network");
	if (network_file.is_open() == false)
	{
		cout << "Error: Cannot open network file: " << our_model.network_fileName << endl;
		exit(-10);
	}

	// Read number of edges
	if (!(network_file >> our_model.m))
	{
		cout << "Error: Malformed network file at line 1 (expected number of edges)" << endl;
		exit(-11);
	}
	delete[] our_model.edge_set;
	our_model.edge_set = new Edge[our_model.m];

	for (int e = 0; e < our_model.m; e++)
	{
		if (!(network_file >> our_model.edge_set[e].n1 >> our_model.edge_set[e].n2 
		      >> our_model.edge_set[e].length >> num_points))
		{
			cout << "Error: Malformed network file at edge " << e 
			     << " (expected: n1 n2 length num_points)" << endl;
			exit(-11);
		}

		for (int i = 0; i < num_points; i++)
		{
			p.edge_index = e;
			if (!(network_file >> p.dist_n1 >> p.dist_n2))
			{
				cout << "Error: Malformed network file at edge " << e << ", point " << i
				     << " (expected: dist_n1 dist_n2)" << endl;
				exit(-11);
			}
			
			// Read time field if kdv_type=3 (spatiotemporal mode)
			if (our_model.kdv_type == 3)
			{
				if (!(network_file >> p.time))
				{
					cout << "Error: Missing time field for point " << i 
					     << " on edge " << e << " (kdv_type=3 requires time)" << endl;
					exit(-2);
				}
			}
			else
			{
				p.time = 0.0; // Default time for spatial mode
			}
			
			our_model.edge_set[e].PS.push_back(p);
			our_model.edge_set[e].aug_dist_diff_vec.push_back(-inf);
			our_model.edge_set[e].dist_n1_vec.push_back(-1);
			our_model.edge_set[e].dist_n2_vec.push_back(-1);
		}
	}

	network_file >> our_model.n;
	our_model.Network.clear();
	our_model.Network.resize(our_model.n); // 可根据需求重新分配大小
	for (int v = 0; v < our_model.n; v++)
	{
		our_model.Network.push_back(tempVector);
		network_file >> degree;
		for (int e = 0; e < degree; e++)
		{
			network_file >> edge_index;
			our_model.Network[v].push_back(edge_index);
		}
	}

	network_file.close();
}

void init_dijkstra(model& our_model)
{
	our_model.sp_node_vec.clear();
	our_model.sp_node_vec_node_a.clear();
	our_model.sp_node_vec_node_b.clear();
	//init the Dijkstra's algorithm
	sp_node temp_sp_Node;
	for (int v = 0; v < our_model.n; v++)
	{
		our_model.sp_node_vec.push_back(temp_sp_Node);

		if (our_model.method >= 2 && our_model.method <= 5)
		{
			our_model.sp_node_vec_node_a.push_back(temp_sp_Node);
			our_model.sp_node_vec_node_b.push_back(temp_sp_Node);
		}
	}
}	

void add_lixels_for_edge(int e, model& our_model)
{
	double cur_dist = 0;
	double middle_dist;
	double next_dist;
	double length = our_model.edge_set[e].length;
	Lixel l;
	
	while (cur_dist < length)
	{
		next_dist = cur_dist + our_model.lixel_reg_length;
		if (next_dist > length)
			next_dist = length;

		middle_dist = (cur_dist + next_dist) / 2.0;
		l.dist_n1 = middle_dist;
		l.dist_n2 = length - middle_dist;
		l.edge_index = e;
		l.KDE_value = -100;
		
		// Set time for spatiotemporal mode
		if (our_model.kdv_type == 3) {
			l.time = our_model.cur_t;
		} else {
			l.time = 0.0;
		}
		
		our_model.lixel_set.push_back(l);

		cur_dist += our_model.lixel_reg_length;
	}
}

void obtain_lixel_set(model& our_model)
{
	our_model.lixel_set.clear();
	for (int e = 0; e < our_model.m; e++)
		add_lixels_for_edge(e, our_model);

	// Log lixel generation (works correctly with clipped network)
	cout << "Generated " << our_model.lixel_set.size() << " lixels on " 
	     << our_model.m << " edges" << endl;
}

void init_parameters(int argc, char** argv, model& our_model)
{
	//debug
	// our_model.network_fileName = (char*)"../../../Datasets/Testing/Testing_network";
	// our_model.out_NKDV_fileName = (char*)"Results/Testing_M3_K1";
	// our_model.method = 3;
	// our_model.lixel_reg_length = 50;
	// our_model.k_type = 2;
	// our_model.bandwidth = 1000;
	our_model.network_fileName = argv[1];
	our_model.out_NKDV_fileName = argv[2];
	our_model.method = atoi(argv[3]);
	our_model.lixel_reg_length = atoi(argv[4]);
	our_model.k_type = atoi(argv[5]);
	our_model.bandwidth = atof(argv[6]);
	our_model.gamma = 1;

	//Gaussian kernel
	if (our_model.k_type == 0)
		our_model.gamma = 9 / (2 * our_model.bandwidth * our_model.bandwidth);
	//Triangular kernel
	if (our_model.k_type == 1)
		our_model.gamma = 1 / our_model.bandwidth;
	//Epanechnikov and Quartic kernels
	if (our_model.k_type == 2 || our_model.k_type == 3)
		our_model.gamma = 1 / (our_model.bandwidth*our_model.bandwidth);
}



void output_Visual(model& our_model)
{
	int edge_index;
	double dist_n1, dist_n2;
	double KDE_value;
	fstream out_NKDV_file;

	out_NKDV_file.open(our_model.out_NKDV_fileName, ios::in | ios::out | ios::trunc);
	if (out_NKDV_file.is_open() == false)
	{
		out_NKDV_file << "Cannot open output file!" << endl;
		exit(0);
	}

	out_NKDV_file << our_model.lixel_set.size() << endl;
	for (int l = 0; l < (int)our_model.lixel_set.size(); l++)
	{
		edge_index = our_model.lixel_set[l].edge_index;
		dist_n1 = our_model.lixel_set[l].dist_n1;
		dist_n2 = our_model.lixel_set[l].dist_n2;
		KDE_value = our_model.lixel_set[l].KDE_value;
		out_NKDV_file << edge_index << " " << dist_n1 << " " << dist_n2 << " " << KDE_value << endl;
	}

	out_NKDV_file.close();
}

// Spatial clipping functions

bool is_point_in_bounding_box(double x, double y, model& our_model)
{
	return (x >= our_model.x_L && x <= our_model.x_U &&
	        y >= our_model.y_L && y <= our_model.y_U);
}

void clip_points_by_bounds(model& our_model)
{
	// Clip points on each edge based on their coordinates
	// Points are defined by their distance from edge endpoints
	// We need to calculate actual coordinates and filter
	
	if (our_model.node_coords == nullptr)
	{
		cout << "Warning: Node coordinates not available, skipping point clipping" << endl;
		return;
	}
	
	int total_points_before = 0;
	int total_points_after = 0;
	
	for (int e = 0; e < our_model.m; e++)
	{
		Edge& edge = our_model.edge_set[e];
		int n1 = edge.n1;
		int n2 = edge.n2;
		
		double x1 = our_model.node_coords[n1].x;
		double y1 = our_model.node_coords[n1].y;
		double x2 = our_model.node_coords[n2].x;
		double y2 = our_model.node_coords[n2].y;
		
		vector<Point> filtered_points;
		total_points_before += edge.PS.size();
		
		for (size_t i = 0; i < edge.PS.size(); i++)
		{
			Point& p = edge.PS[i];
			
			// Calculate point coordinates using linear interpolation
			// Point is at distance dist_n1 from n1 along the edge
			double t = p.dist_n1 / edge.length; // interpolation parameter [0, 1]
			double px = x1 + t * (x2 - x1);
			double py = y1 + t * (y2 - y1);
			
			// Keep point if it's inside bounding box
			if (is_point_in_bounding_box(px, py, our_model))
			{
				filtered_points.push_back(p);
			}
		}
		
		total_points_after += filtered_points.size();
		edge.PS = filtered_points;
		
		// Update augmentation vectors to match new point count
		edge.dist_n1_vec.resize(filtered_points.size(), -1);
		edge.dist_n2_vec.resize(filtered_points.size(), -1);
		edge.aug_dist_diff_vec.resize(filtered_points.size(), -inf);
	}
	
	cout << "Points kept after clipping: " << total_points_after 
	     << " / " << total_points_before << endl;
}

void clip_network_by_bounds(model& our_model)
{
	cout << "Spatial clipping: bounding box [" 
	     << our_model.x_L << ", " << our_model.x_U << "] x ["
	     << our_model.y_L << ", " << our_model.y_U << "]" << endl;
	
	// Check if node coordinates are available
	if (our_model.node_coords == nullptr)
	{
		cout << "Warning: Node coordinates not available, skipping spatial clipping" << endl;
		return;
	}
	
	vector<bool> edge_to_keep(our_model.m, false);
	int edges_kept = 0;
	
	// Step 1: Determine which edges to keep
	// Keep edge if at least one endpoint is inside bounding box
	for (int e = 0; e < our_model.m; e++)
	{
		int n1 = our_model.edge_set[e].n1;
		int n2 = our_model.edge_set[e].n2;
		
		bool n1_inside = is_point_in_bounding_box(
			our_model.node_coords[n1].x,
			our_model.node_coords[n1].y,
			our_model
		);
		
		bool n2_inside = is_point_in_bounding_box(
			our_model.node_coords[n2].x,
			our_model.node_coords[n2].y,
			our_model
		);
		
		// Keep edge if at least one endpoint is inside
		if (n1_inside || n2_inside)
		{
			edge_to_keep[e] = true;
			edges_kept++;
		}
	}
	
	cout << "Edges kept after clipping: " << edges_kept << " / " << our_model.m << endl;
	
	// Step 2: Create new edge array with only kept edges
	if (edges_kept == 0)
	{
		cout << "Warning: Network is empty after clipping" << endl;
		our_model.m = 0;
		delete[] our_model.edge_set;
		our_model.edge_set = new Edge[0];
		return;
	}
	
	Edge* new_edge_set = new Edge[edges_kept];
	int new_edge_index = 0;
	
	for (int e = 0; e < our_model.m; e++)
	{
		if (edge_to_keep[e])
		{
			new_edge_set[new_edge_index] = our_model.edge_set[e];
			new_edge_index++;
		}
	}
	
	// Replace old edge set with new one
	delete[] our_model.edge_set;
	our_model.edge_set = new_edge_set;
	our_model.m = edges_kept;
	
	cout << "Edge clipping completed" << endl;
}

void reindex_network(model& our_model)
{
	// After clipping, reindex nodes and edges to have contiguous indices
	// This ensures indices are 0, 1, 2, ..., n-1 with no gaps
	
	// Step 1: Find all nodes that are still referenced by remaining edges
	vector<bool> node_used(our_model.n, false);
	for (int e = 0; e < our_model.m; e++)
	{
		node_used[our_model.edge_set[e].n1] = true;
		node_used[our_model.edge_set[e].n2] = true;
	}
	
	// Step 2: Create mapping from old node indices to new node indices
	vector<int> old_to_new_node(our_model.n, -1);
	int new_node_count = 0;
	for (int v = 0; v < our_model.n; v++)
	{
		if (node_used[v])
		{
			old_to_new_node[v] = new_node_count;
			new_node_count++;
		}
	}
	
	// Step 3: Update edge references to use new node indices
	for (int e = 0; e < our_model.m; e++)
	{
		our_model.edge_set[e].n1 = old_to_new_node[our_model.edge_set[e].n1];
		our_model.edge_set[e].n2 = old_to_new_node[our_model.edge_set[e].n2];
	}
	
	// Step 4: Create new node coordinates array with only used nodes
	if (our_model.node_coords != nullptr)
	{
		Node* new_node_coords = new Node[new_node_count];
		for (int v = 0; v < our_model.n; v++)
		{
			if (node_used[v])
			{
				int new_idx = old_to_new_node[v];
				new_node_coords[new_idx] = our_model.node_coords[v];
				new_node_coords[new_idx].node_id = new_idx;
			}
		}
		delete[] our_model.node_coords;
		our_model.node_coords = new_node_coords;
	}
	
	// Step 5: Rebuild adjacency lists
	our_model.Network.clear();
	our_model.Network.resize(new_node_count);
	for (int e = 0; e < our_model.m; e++)
	{
		int n1 = our_model.edge_set[e].n1;
		int n2 = our_model.edge_set[e].n2;
		our_model.Network[n1].push_back(e);
		our_model.Network[n2].push_back(e);
	}
	
	// Update node count
	int old_n = our_model.n;
	our_model.n = new_node_count;
	
	cout << "Network reindexing completed: " << old_n << " -> " << our_model.n << " nodes" << endl;
}

// Time window management functions

void sort_points_by_time(model& our_model)
{
	// Collect all points from all edges
	our_model.sorted_points_by_time.clear();
	
	for (int e = 0; e < our_model.m; e++)
	{
		for (size_t i = 0; i < our_model.edge_set[e].PS.size(); i++)
		{
			our_model.sorted_points_by_time.push_back(&our_model.edge_set[e].PS[i]);
		}
	}
	
	// Sort points by time using lambda comparator
	sort(our_model.sorted_points_by_time.begin(), 
	     our_model.sorted_points_by_time.end(),
	     [](const Point* a, const Point* b) {
	         return a->time < b->time;
	     });
	
	cout << "Sorted " << our_model.sorted_points_by_time.size() 
	     << " points by time" << endl;
}

void find_time_window(model& our_model, double cur_time)
{
	// Use binary search to find time window bounds
	// Window is [cur_time - bandwidth_t, cur_time + bandwidth_t]
	
	double time_lower = cur_time - our_model.bandwidth_t;
	double time_upper = cur_time + our_model.bandwidth_t;
	
	// Find start position using lower_bound
	// lower_bound returns iterator to first element >= time_lower
	auto start_it = lower_bound(
		our_model.sorted_points_by_time.begin(),
		our_model.sorted_points_by_time.end(),
		time_lower,
		[](const Point* p, double val) {
			return p->time < val;
		}
	);
	
	// Find end position using upper_bound
	// upper_bound returns iterator to first element > time_upper
	auto end_it = upper_bound(
		our_model.sorted_points_by_time.begin(),
		our_model.sorted_points_by_time.end(),
		time_upper,
		[](double val, const Point* p) {
			return val < p->time;
		}
	);
	
	our_model.start_t_win_pos = start_it - our_model.sorted_points_by_time.begin();
	our_model.end_t_win_pos = end_it - our_model.sorted_points_by_time.begin() - 1;
	
	// Handle empty window case
	if (our_model.start_t_win_pos > our_model.end_t_win_pos)
	{
		our_model.start_t_win_pos = 0;
		our_model.end_t_win_pos = -1; // Empty window
	}
}

// Load edge geometry from CSV file
void load_edge_geometry(model& our_model, const char* geometry_file)
{
	fstream geo_file;
	string line;
	
	cout << "Loading edge geometry from: " << geometry_file << endl;
	
	geo_file.open(geometry_file);
	if (!geo_file.is_open())
	{
		cout << "Error: Cannot open geometry file: " << geometry_file << endl;
		exit(-20);
	}
	
	// Skip header line
	getline(geo_file, line);
	
	// Build a map to track unique nodes and their coordinates
	map<int, pair<double, double>> node_coord_map;
	int edges_processed = 0;
	
	while (getline(geo_file, line))
	{
		if (line.empty()) continue;
		
		// Parse CSV: edge_index,u_lon,u_lat,v_lon,v_lat
		stringstream ss(line);
		string token;
		vector<string> tokens;
		
		while (getline(ss, token, ','))
		{
			tokens.push_back(token);
		}
		
		if (tokens.size() != 5)
		{
			cout << "Warning: Malformed line in geometry file: " << line << endl;
			continue;
		}
		
		int edge_index = stoi(tokens[0]);
		double u_lon = stod(tokens[1]);
		double u_lat = stod(tokens[2]);
		double v_lon = stod(tokens[3]);
		double v_lat = stod(tokens[4]);
		
		// Check if edge exists in our network
		if (edge_index >= 0 && edge_index < our_model.m)
		{
			Edge& edge = our_model.edge_set[edge_index];
			
			// Store node coordinates
			node_coord_map[edge.n1] = make_pair(u_lon, u_lat);
			node_coord_map[edge.n2] = make_pair(v_lon, v_lat);
			
			edges_processed++;
		}
	}
	
	geo_file.close();
	
	// Allocate and fill node_coords array
	our_model.node_coords = new Node[our_model.n];
	
	for (int v = 0; v < our_model.n; v++)
	{
		our_model.node_coords[v].node_id = v;
		
		if (node_coord_map.find(v) != node_coord_map.end())
		{
			our_model.node_coords[v].x = node_coord_map[v].first;  // longitude
			our_model.node_coords[v].y = node_coord_map[v].second; // latitude
		}
		else
		{
			// Node not found in geometry file
			our_model.node_coords[v].x = 0;
			our_model.node_coords[v].y = 0;
			cout << "Warning: Node " << v << " not found in geometry file" << endl;
		}
	}
	
	cout << "Loaded geometry for " << edges_processed << " edges and " 
	     << node_coord_map.size() << " unique nodes" << endl;
}
