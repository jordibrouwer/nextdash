<?php
/**
 * The feature pages for v1.19.9: a new App discovery page, and what the
 * release changes on Install, Containers, Inbox and Data. Run inside the
 * WordPress container:
 *
 *   docker cp v1.19.9-pages.php <container>:/tmp/v1199.php
 *   docker exec -e ND_HOST=nextdash.cc [-e ND_PUBLISH=1] <container> php /tmp/v1199.php
 *
 * The new page goes up as a draft unless ND_PUBLISH=1. Each change to an
 * existing page is made once: a page that already has it, or no longer has
 * the sentence it replaces, is left alone and named in the output.
 */

$_SERVER['HTTP_HOST'] = getenv( 'ND_HOST' ) ?: 'localhost';
chdir( '/var/www/html' );
require '/var/www/html/wp-load.php';

$parent = get_page_by_path( 'features' );
if ( ! $parent ) {
	fwrite( STDERR, "No Features page.\n" );
	exit( 1 );
}

// ---- The new page ----------------------------------------------------------

$slug = 'app-discovery';
if ( get_page_by_path( 'features/' . $slug ) ) {
	echo "$slug: exists, left alone\n";
} else {
	$content = '<p>With the Docker socket connected, nextDash looks at the containers that run and notices which of them answer with a web page or a login. It offers those apps as bookmarks on a card in the middle of the dashboard, grouped by kind and all ticked.</p>'
		. '<p>Add puts the ticked apps on the page: one category per kind, each app with its icon, a status check and a link to its container. On a page that still holds the starter links, they can be replaced in the same go, and Undo brings them back.</p>'
		. '<h2>Try it</h2><ol><li>Connect the Docker socket; Config, then Containers, says whether it answers.</li><li>Open the dashboard. The card lists the apps nextDash found.</li><li>Untick what you do not want and press Add.</li></ol>'
		. '[nd_shot src="app-discovery/shot-1.jpg" alt="The apps-found card with eight apps, grouped by kind" caption="Eight apps found on this server, grouped by kind."]'
		. '<h2>A container that turns up later</h2><p>A new container is asked about first, with Add, Ignore and Not now. Config, then Containers, can also add new apps straight away, with an Undo, or propose them in the Inbox, where Promote fills in the bookmark form. The apps you turned down are listed there too, each with Remove, so nextDash notices it again.</p>'
		. '[nd_shot src="app-discovery/shot-2.jpg" alt="A card asking about a new container" caption="A new container, asked about first."]'
		. '[nd_shot src="app-discovery/shot-3.jpg" alt="Config, Containers: Suggest new apps, New apps and the ignored apps" caption="How new apps are handled, and the ones turned down."]'
		. '[nd_shot src="app-discovery/shot-4.jpg" alt="New apps proposed in the Inbox, with Promote and Ignore" caption="New apps proposed in the Inbox."]'
		. '<h2>Steer it with labels</h2><p>Labels on a container decide the details. <code>nextdash.url</code> sets the address and wins over everything else, <code>nextdash.name</code> the name, <code>nextdash.category</code> the category and <code>nextdash.icon</code> the icon. <code>nextdash.hide=true</code> keeps a container out. Without a label, the address comes from a reverse-proxy label or a published port.</p>';
	$id = wp_insert_post(
		array(
			'post_type'     => 'page',
			'post_status'   => getenv( 'ND_PUBLISH' ) ? 'publish' : 'draft',
			'post_parent'   => $parent->ID,
			'post_name'     => $slug,
			'post_title'    => 'App discovery',
			'post_content'  => $content,
			'page_template' => 'page-feature.php',
		),
		true
	);
	if ( is_wp_error( $id ) ) {
		fwrite( STDERR, "$slug: " . $id->get_error_message() . "\n" );
	} else {
		$meta = array(
			'ndt_feature_group'   => 'selfhost',
			'ndt_feature_order'   => '1',
			'ndt_feature_blurb'   => 'nextDash finds the apps in your containers and offers them as bookmarks.',
			'ndt_feature_thumb'   => 'app-discovery/poster.jpg',
			'ndt_feature_video'   => 'app-discovery',
			'ndt_feature_related' => 'containers,inbox,custom-widgets',
			'ndt_feature_since'   => '1.19.9',
		);
		foreach ( $meta as $k => $v ) {
			update_post_meta( $id, $k, $v );
		}
		echo "$slug: added (#$id)\n";
	}
}

// ---- Changes to existing pages ---------------------------------------------

/**
 * One change to a page: $find is replaced by $with, or, when $find is null,
 * $with is added at the end. $done is a phrase that shows the change is in.
 */
function ndw_change( $slug, $done, $find, $with ) {
	$page = get_page_by_path( 'features/' . $slug );
	if ( ! $page ) {
		echo "$slug: no such page\n";
		return;
	}
	$content = $page->post_content;
	if ( false !== strpos( $content, $done ) ) {
		echo "$slug: already has it\n";
		return;
	}
	if ( null === $find ) {
		$content .= $with;
	} elseif ( false !== strpos( $content, $find ) ) {
		$content = str_replace( $find, $with, $content );
	} else {
		echo "$slug: the sentence to replace is not there, left alone\n";
		return;
	}
	wp_update_post( array( 'ID' => $page->ID, 'post_content' => $content ) );
	echo "$slug: changed\n";
}

ndw_change(
	'install',
	'start with an empty page',
	'a quick-start card greets a brand-new install.',
	'a brand-new install asks what you want first: keep the example links to look around, or start with an empty page.'
);
ndw_change(
	'install',
	'onto the dashboard, or into the Inbox first',
	null,
	'<h2>Bringing your bookmarks</h2><p>An import asks where the bookmarks go: onto the dashboard, or into the Inbox first, so you can sort them before they land on a page.</p>[nd_shot src="install/first-start.jpg" alt="The first-start card: keep the example links, or start with an empty page" caption="A first start: keep the example links, or start empty."]'
);
ndw_change(
	'containers',
	'features/app-discovery',
	null,
	'<p>A container with a web page can become a bookmark on its own: nextDash notices it and offers it. See <a href="/features/app-discovery/">App discovery</a>.</p>'
);
ndw_change(
	'inbox',
	'found on this server',
	null,
	'<h2>New apps from your containers</h2><p>When nextDash finds a new app in your containers, it can propose it here, marked as found on this server. Promote fills in the bookmark form; Ignore keeps that app out. <a href="/features/app-discovery/">App discovery</a> has the rest.</p>'
);
ndw_change(
	'data',
	'a folder becomes a tag',
	null,
	'<h2>Where an import goes</h2><p>An import asks where the bookmarks go: onto the dashboard, or into the Inbox first. Into the Inbox, a folder becomes a tag instead of a category, and a link the dashboard already holds is skipped.</p>'
);
