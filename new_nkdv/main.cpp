#include "init.h"
#include "alg_NKDV.h"
model our_model;
std::string output_buffer;
// int main(int argc, char**argv)
// {
// 	model our_model;
// 	init_parameters(argc, argv, our_model);
// 	load_network(our_model);
// 	init_dijkstra(our_model);
// 	obtain_lixel_set(our_model);
// 	NKDV_algorithm(our_model);
// 	output_Visual(our_model);
// 	return 0;
// }
extern "C"{
	// Scenario B: Compute with pre-clipping
	// This function applies spatial clipping BEFORE computing KDE
	// So each region gets independent KDE calculation
	const char* compute(){
		// Apply spatial clipping if geometry is loaded and bounds are set
		if (our_model.node_coords != nullptr && 
		    (our_model.x_L != 0 || our_model.x_U != 0 || 
		     our_model.y_L != 0 || our_model.y_U != 0))
		{
			cout << "=== Scenario B: Clipping before computation ===" << endl;
			cout << "Bounding box: [" << our_model.x_L << ", " << our_model.x_U 
			     << "] x [" << our_model.y_L << ", " << our_model.y_U << "]" << endl;
			
			clip_network_by_bounds(our_model);
			clip_points_by_bounds(our_model);
			reindex_network(our_model);
			
			cout << "Network after clipping: " << our_model.n << " nodes, " 
			     << our_model.m << " edges" << endl;
		}
		
		// Now compute KDE on the clipped network
		init_dijkstra(our_model);
		obtain_lixel_set(our_model);
		NKDV_algorithm(our_model);

		int edge_index;
		double dist_n1, dist_n2;
		double KDE_value;
		std::ostringstream oss;

		// 写入数量
		oss << our_model.lixel_set.size() << "\n";

		// 写入每个数据行
		const double small_epsilon = 0.0001;
		
		for (int l = 0; l < (int)our_model.lixel_set.size(); l++)
		{
			edge_index = our_model.lixel_set[l].edge_index;
			dist_n1 = our_model.lixel_set[l].dist_n1;
			dist_n2 = our_model.lixel_set[l].dist_n2;
			KDE_value = our_model.lixel_set[l].KDE_value;
			
			// Skip lixels with very small KDE values
			if (KDE_value < small_epsilon)
				continue;
			
			// Output format depends on kdv_type
			if (our_model.kdv_type == 3)
			{
				// Spatiotemporal output: edge_index dist_n1 dist_n2 time KDE_value
				double time = our_model.lixel_set[l].time;
				oss << edge_index << " " << dist_n1 << " " << dist_n2 << " " 
				    << time << " " << KDE_value << endl;
			}
			else
			{
				// Spatial output: edge_index dist_n1 dist_n2 KDE_value
				oss << edge_index << " " << dist_n1 << " " << dist_n2 << " " 
				    << KDE_value << endl;
			}
		}

		// 保存到全局字符串中
		output_buffer = oss.str();
		return output_buffer.c_str();
	}
	// Load network data (call once at initialization)
	// Default: load spatial dataset
	void load_network()
	{
		our_model.network_fileName = (char*)"./datasets/San_Francisco/San_Francisco_network";
		our_model.out_NKDV_fileName = (char*)"Results/Testing_M3_K1";
		our_model.kdv_type = 1; // Default to spatial mode
		load_network(our_model);
		cout << "Network loaded: " << our_model.n << " nodes, " 
		     << our_model.m << " edges" << endl;
	}
	
	// Load spatiotemporal network data (call when kdv_type=3)
	void load_spatiotemporal_network()
	{
		our_model.network_fileName = (char*)"./datasets/San_Francisco/San_Francisco_network_spatiotemporal";
		our_model.out_NKDV_fileName = (char*)"Results/Testing_M3_K1";
		our_model.kdv_type = 3; // Set to spatiotemporal mode
		load_network(our_model);
		cout << "Spatiotemporal network loaded: " << our_model.n << " nodes, " 
		     << our_model.m << " edges" << endl;
	}
	
	// Load edge geometry from CSV (call once after load_network)
	void load_geometry(const char* geometry_file)
	{
		load_edge_geometry(our_model, geometry_file);
		cout << "Geometry loaded from: " << geometry_file << endl;
	}
	
	// Reset network to original state (call before each new region computation)
	void reset_network()
	{
		cout << "Resetting network to original state..." << endl;
		
		// Save node coordinates before clearing
		Node* saved_coords = our_model.node_coords;
		int saved_n = our_model.n;
		
		// Clear current network state
		if (our_model.edge_set != nullptr)
		{
			delete[] our_model.edge_set;
			our_model.edge_set = nullptr;
		}
		our_model.Network.clear();
		our_model.lixel_set.clear();
		our_model.sp_node_vec.clear();
		our_model.sp_node_vec_node_a.clear();
		our_model.sp_node_vec_node_b.clear();
		
		// Temporarily set node_coords to nullptr to avoid double-free
		our_model.node_coords = nullptr;
		
		// Reload original network
		load_network(our_model);
		
		// Restore node coordinates
		// If the network size changed, we need to reload geometry
		if (saved_coords != nullptr)
		{
			if (saved_n == our_model.n)
			{
				// Network size unchanged, restore saved coordinates
				our_model.node_coords = saved_coords;
			}
			else
			{
				// Network size changed, need to reload geometry
				// This shouldn't happen in normal usage
				delete[] saved_coords;
				cout << "Warning: Network size changed during reset, geometry needs to be reloaded" << endl;
			}
		}
		
		cout << "Network reset complete" << endl;
	}
	void load_parameters(
		int method,
		int lixel_reg_length,
		int k_type,
		int bandwidth,
		int kdv_type,
		double t_L,
		double t_U,
		double bandwidth_t,
		double cur_t,
		double x_L,
		double x_U,
		double y_L,
		double y_U
	)
	{
		// Parameter validation
		
		// 12.1 Validate kdv_type
		if (kdv_type != 1 && kdv_type != 3)
		{
			cout << "Error: Invalid kdv_type: " << kdv_type << " (must be 1 or 3)" << endl;
			exit(-1);
		}
		
		// 12.2 Validate bounding box
		if (x_L >= x_U)
		{
			cout << "Error: Invalid bounding box: x_L (" << x_L << ") must be less than x_U (" << x_U << ")" << endl;
			exit(-3);
		}
		if (y_L >= y_U)
		{
			cout << "Error: Invalid bounding box: y_L (" << y_L << ") must be less than y_U (" << y_U << ")" << endl;
			exit(-3);
		}
		
		// 12.3 Validate time range (for kdv_type=3)
		if (kdv_type == 3 && t_L >= t_U)
		{
			cout << "Error: Invalid time range: t_L (" << t_L << ") must be less than t_U (" << t_U << ")" << endl;
			exit(-4);
		}
		
		// 12.4 Validate bandwidth parameters
		if (bandwidth <= 0)
		{
			cout << "Error: Spatial bandwidth must be positive (got " << bandwidth << ")" << endl;
			exit(-5);
		}
		if (kdv_type == 3 && bandwidth_t <= 0)
		{
			cout << "Error: Temporal bandwidth must be positive (got " << bandwidth_t << ")" << endl;
			exit(-5);
		}
		
		// Basic parameters
		our_model.method = method;
		our_model.lixel_reg_length = lixel_reg_length;
		our_model.k_type = k_type;
		our_model.bandwidth = bandwidth;
		our_model.gamma = 1;

		// Spatiotemporal parameters
		our_model.kdv_type = kdv_type;
		our_model.t_L = t_L;
		our_model.t_U = t_U;
		our_model.bandwidth_t = bandwidth_t;
		our_model.cur_t = cur_t; // Use provided cur_t
		our_model.k_type_t = 2; // Default to Epanechnikov for temporal kernel
		our_model.gamma_t = 1;

		// Spatial clipping parameters
		our_model.x_L = x_L;
		our_model.x_U = x_U;
		our_model.y_L = y_L;
		our_model.y_U = y_U;

		cout << "method: " << our_model.method << endl;
		cout << "kdv_type: " << our_model.kdv_type << endl;

		// Spatial kernel gamma
		if (our_model.k_type == 0) // Gaussian kernel
			our_model.gamma = 9 / (2 * our_model.bandwidth * our_model.bandwidth);
		if (our_model.k_type == 1) // Triangular kernel
			our_model.gamma = 1 / our_model.bandwidth;
		if (our_model.k_type == 2 || our_model.k_type == 3) // Epanechnikov and Quartic kernels
			our_model.gamma = 1 / (our_model.bandwidth * our_model.bandwidth);

		// Temporal kernel gamma (for kdv_type=3)
		if (our_model.kdv_type == 3)
		{
			if (our_model.k_type_t == 0) // Gaussian kernel
				our_model.gamma_t = 9 / (2 * our_model.bandwidth_t * our_model.bandwidth_t);
			if (our_model.k_type_t == 1) // Triangular kernel
				our_model.gamma_t = 1 / our_model.bandwidth_t;
			if (our_model.k_type_t == 2 || our_model.k_type_t == 3) // Epanechnikov and Quartic kernels
				our_model.gamma_t = 1 / (our_model.bandwidth_t * our_model.bandwidth_t);
		}
	}
	
}
