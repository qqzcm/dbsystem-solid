#pragma once
#ifndef INIT_H
#define INIT_H

#include "Network.h"

const double inf = 999999999999999;
const double eps = 0.00000000001;
const double const_diff_eps = 0.00001; //Used in IA

void load_network(model& our_model);
void init_dijkstra(model& our_model);
void obtain_lixel_set(model& our_model);
void init_parameters(int argc, char** argv, model& our_model);
void output_Visual(model& our_model);

// Spatial clipping functions
void load_edge_geometry(model& our_model, const char* geometry_file);
bool is_point_in_bounding_box(double x, double y, model& our_model);
void clip_points_by_bounds(model& our_model);
void clip_network_by_bounds(model& our_model);
void reindex_network(model& our_model);

// Time window management functions (for kdv_type=3)
void sort_points_by_time(model& our_model);
void find_time_window(model& our_model, double cur_time);


#endif